import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { requireAdminApiPermissionContext } from "@/lib/admin-sessions";
import { refreshDealVisibility } from "@/lib/deal-visibility";
import { validateDealSchedule } from "@/lib/deal-schedule";
import {
  DEAL_BASE_ISSUE_CODES,
  firstRepairMessage,
  validateOptionalDealBaseReference,
} from "@/lib/deal-base-validation";
import { resolveAllowedImageHosts } from "@/lib/image-urls";
import {
  ImageProcessingError,
  processUploadedImage,
} from "@/lib/image-processing";
import { itemSnapshotFromRecord, writeMenuAuditAndRevision } from "@/lib/menu-history";
import {
  type AdminItemInput,
  enrichUpgradeOptions,
  normalizeDealShellStockInput,
  validateItemInput,
} from "@/lib/menu-admin";
import { recordAdminStockMovement } from "@/lib/menu-stock-movements";
import {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
  MAX_MULTIPART_BODY_BYTES,
  StorageNotConfiguredError,
} from "@/lib/storage";
import { getStorageDriver, getStorageMode } from "@/lib/storage-driver";
import { ensureLocalStorageReady } from "@/lib/storage-local";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function validateProvidedDealBaseInput({
  itemInput,
  outletId,
  dealId,
}: {
  itemInput: AdminItemInput;
  outletId: string;
  dealId: string;
}) {
  if (!itemInput.dealBaseMenuItemId) return null;

  const base = await prisma.menuItem.findUnique({
    where: { id: itemInput.dealBaseMenuItemId },
    select: {
      id: true,
      outletId: true,
      name: true,
      category: { select: { id: true, slug: true } },
      sizes: { select: { id: true, name: true } },
    },
  });
  const baseIssue = firstRepairMessage(
    validateOptionalDealBaseReference({
      id: dealId,
      name: itemInput.name,
      outletId,
      dealBaseMenuItemId: itemInput.dealBaseMenuItemId,
      dealBaseMenuItem: base,
    })
  );
  if (baseIssue) return baseIssue;

  const baseSize = itemInput.dealBaseSizeId
    ? (base?.sizes.find((size) => size.id === itemInput.dealBaseSizeId) ?? null)
    : null;
  if (itemInput.dealBaseSizeId && !baseSize) {
    return {
      code: DEAL_BASE_ISSUE_CODES.BASE_SIZE_INVALID,
      severity: "repair" as const,
      message: "Deal base size must belong to the selected base item.",
      dealId,
      dealName: itemInput.name,
      menuItemId: itemInput.dealBaseMenuItemId,
    };
  }

  itemInput.dealBaseSizeNameSnapshot = baseSize?.name ?? null;
  return null;
}

const ITEM_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  sizes: { orderBy: { sortOrder: "asc" } },
  addons: { orderBy: { sortOrder: "asc" } },
  upgradeOptions: {
    orderBy: { sortOrder: "asc" },
    include: {
      linkedItems: {
        orderBy: { sortOrder: "asc" },
        include: {
          linkedMenuItem: {
            select: {
              id: true,
              name: true,
              emoji: true,
              bgColor: true,
              isActive: true,
              isOutOfStock: true,
              stockMode: true,
              stockQty: true,
              price: true,
              sizes: { select: { id: true } },
            },
          },
          linkedSize: { select: { id: true, name: true, priceDelta: true } },
        },
      },
    },
  },
} satisfies Prisma.MenuItemInclude;

function serializeItem(
  item: Prisma.MenuItemGetPayload<{ include: typeof ITEM_INCLUDE }>
) {
  const upgradeOptions =
    item.category.slug === "deals" ? item.upgradeOptions : [];
  return {
    ...item,
    price: Number(item.price),
    bundleSavings: item.bundleSavings != null ? Number(item.bundleSavings) : null,
    dealStartsAt: item.dealStartsAt?.toISOString() ?? null,
    dealExpiresAt: item.dealExpiresAt?.toISOString() ?? null,
    dealLimitUpdatedAt: item.dealLimitUpdatedAt?.toISOString() ?? null,
    stockUpdatedAt: item.stockUpdatedAt?.toISOString() ?? null,
    sizes: item.sizes.map((s) => ({ ...s, priceDelta: Number(s.priceDelta) })),
    addons: item.addons.map((a) => ({ ...a, priceDelta: Number(a.priceDelta) })),
    upgradeOptions: upgradeOptions.map((upgrade) => ({
      id: upgrade.id,
      customTitle: upgrade.customTitle,
      extraCharge: Number(upgrade.extraCharge),
      savingsLabel:
        upgrade.savingsLabel != null ? Number(upgrade.savingsLabel) : null,
      discountPct:
        upgrade.discountPct != null ? Number(upgrade.discountPct) : null,
      sortOrder: upgrade.sortOrder,
      linkedItems: upgrade.linkedItems.map((link) => ({
        id: link.id,
        linkedMenuItemId: link.linkedMenuItemId,
        linkedSizeId: link.linkedSizeId,
        itemNameSnapshot: link.itemNameSnapshot,
        sizeNameSnapshot: link.sizeNameSnapshot,
        sortOrder: link.sortOrder,
        linkedMenuItem: link.linkedMenuItem
          ? {
              id: link.linkedMenuItem.id,
              name: link.linkedMenuItem.name,
              emoji: link.linkedMenuItem.emoji,
              bgColor: link.linkedMenuItem.bgColor,
              isActive: link.linkedMenuItem.isActive,
              isOutOfStock: link.linkedMenuItem.isOutOfStock,
              stockMode: link.linkedMenuItem.stockMode,
              stockQty: link.linkedMenuItem.stockQty,
              price: Number(link.linkedMenuItem.price),
              sizeCount: link.linkedMenuItem.sizes.length,
            }
          : null,
        linkedSize: link.linkedSize
          ? {
              id: link.linkedSize.id,
              name: link.linkedSize.name,
              priceDelta: Number(link.linkedSize.priceDelta),
            }
          : null,
      })),
    })),
  };
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminApiPermissionContext(req, "admin.menu.read");
  if (!auth.ok) return auth.response;

  const items = await prisma.menuItem.findMany({
    where: { outletId: auth.context.outletId },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: ITEM_INCLUDE,
  });
  return NextResponse.json({
    items: items.map(serializeItem),
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminApiPermissionContext(req, "admin.menu.write");
  if (!auth.ok) return auth.response;

  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.startsWith("multipart/form-data")) {
    return handleMultipartPost(req, auth.context.outletId, auth.context.actor.userId);
  }
  return handleJsonPost(req, auth.context.outletId, auth.context.actor.userId);
}

async function handleJsonPost(
  req: NextRequest,
  outletId: string,
  actorUserId: string
) {
  const allowedImageHosts = resolveAllowedImageHosts(
    process.env.NEXT_PUBLIC_IMAGE_CDN_BASE,
    process.env.IMAGE_PASTE_URL_ALLOWLIST
  );
  const validation = validateItemInput(
    await req.json().catch(() => null),
    { allowedImageHosts }
  );
  if (!validation.value) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  return createItem(validation.value, outletId, actorUserId, undefined);
}

async function handleMultipartPost(
  req: NextRequest,
  outletId: string,
  actorUserId: string
) {
  const contentLengthHeader = req.headers.get("content-length");
  if (contentLengthHeader) {
    const n = Number(contentLengthHeader);
    if (Number.isFinite(n) && n > MAX_MULTIPART_BODY_BYTES) {
      return NextResponse.json(
        {
          error: `Upload body exceeds the ${MAX_MULTIPART_BODY_BYTES}-byte limit`,
        },
        { status: 413 }
      );
    }
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid multipart body" },
      { status: 400 }
    );
  }

  const itemFieldRaw = form.get("item");
  if (typeof itemFieldRaw !== "string") {
    return NextResponse.json(
      { error: "item field is required" },
      { status: 400 }
    );
  }
  let rawItem: unknown;
  try {
    rawItem = JSON.parse(itemFieldRaw);
  } catch {
    return NextResponse.json(
      { error: "item field is invalid JSON" },
      { status: 400 }
    );
  }

  const allowedImageHosts = resolveAllowedImageHosts(
    process.env.NEXT_PUBLIC_IMAGE_CDN_BASE,
    process.env.IMAGE_PASTE_URL_ALLOWLIST
  );
  const validation = validateItemInput(rawItem, { allowedImageHosts });
  if (!validation.value) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const itemInput = validation.value;

  const heroFileValue = form.get("heroFile");
  let heroFileBuffer: Buffer | null = null;
  if (heroFileValue instanceof File && heroFileValue.size > 0) {
    const heroContentType = heroFileValue.type.toLowerCase();
    if (
      !(ACCEPTED_IMAGE_CONTENT_TYPES as readonly string[]).includes(
        heroContentType
      )
    ) {
      return NextResponse.json(
        {
          error: `contentType must be one of ${ACCEPTED_IMAGE_CONTENT_TYPES.join(", ")}`,
        },
        { status: 400 }
      );
    }
    if (heroFileValue.size > MAX_IMAGE_UPLOAD_BYTES) {
      return NextResponse.json(
        {
          error: `file must be between 1 and ${MAX_IMAGE_UPLOAD_BYTES} bytes`,
        },
        { status: 400 }
      );
    }
    heroFileBuffer = Buffer.from(await heroFileValue.arrayBuffer());
  }

  if (heroFileBuffer && getStorageMode() === "local") {
    const ready = await ensureLocalStorageReady();
    if (!ready.ok) {
      return NextResponse.json({ error: ready.reason }, { status: 503 });
    }
  }

  // Pre-generate the item id so `driver.uploadImage` and the DB create share
  // the same path segment. randomUUID is accepted by `ITEM_ID_REGEX_SOURCE`
  // (alphanumeric + dash + underscore) and is used elsewhere for `uploadId`.
  let preGeneratedItemId: string | undefined;

  if (heroFileBuffer) {
    preGeneratedItemId = randomUUID();

    let processed;
    try {
      processed = await processUploadedImage(heroFileBuffer, {
        target: "hero",
      });
    } catch (err) {
      if (err instanceof ImageProcessingError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      throw err;
    }

    let driverResult;
    try {
      const driver = await getStorageDriver();
      driverResult = await driver.uploadImage({
        itemId: preGeneratedItemId,
        uploadId: randomUUID(),
        hero: processed.hero,
        thumb: processed.thumb,
      });
    } catch (err) {
      if (err instanceof StorageNotConfiguredError) {
        return NextResponse.json({ error: err.message }, { status: 503 });
      }
      throw err;
    }

    itemInput.imageUrl = driverResult.imageUrl;
  }

  // Hero-only persistence: legacy card overrides are never written from the
  // multipart path.
  itemInput.cardImageUrl = null;
  itemInput.cardImageAlt = null;

  return createItem(itemInput, outletId, actorUserId, preGeneratedItemId);
}

async function createItem(
  itemInput: AdminItemInput,
  outletId: string,
  actorUserId: string,
  preGeneratedItemId?: string
) {
  const category = await prisma.category.findUnique({
    where: { id: itemInput.categoryId },
    select: { id: true, slug: true, outletId: true },
  });
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 400 });
  }
  if (category.outletId !== outletId) {
    return NextResponse.json(
      { error: "Category belongs to a different outlet" },
      { status: 400 }
    );
  }
  const isDeal = category.slug === "deals";
  const persistedItemInput = normalizeDealShellStockInput(itemInput, isDeal);
  const now = new Date();
  const initialDealLimitQty =
    isDeal && itemInput.dealLimitMode === "LIMITED" ? itemInput.dealLimitQty : null;
  const initialDealLimitLowThreshold = isDeal
    ? itemInput.dealLimitLowThreshold
    : null;
  if (isDeal) {
    const schedule = validateDealSchedule({
      startsAt: itemInput.dealStartsAt,
      expiresAt: itemInput.dealExpiresAt,
    });
    if (!schedule.ok) {
      return NextResponse.json({ error: schedule.message }, { status: 400 });
    }
  }
  if (isDeal && itemInput.dealExpiresAt == null) {
    return NextResponse.json(
      { error: "Deal expiration is required" },
      { status: 400 }
    );
  }
  if (isDeal && !itemInput.dealBaseMenuItemId) {
    return NextResponse.json(
      {
        error: "Deal base item is required",
        errorCode: "deal_base_missing",
      },
      { status: 400 }
    );
  }
  if (!isDeal && itemInput.upgradeOptions.length > 0) {
    return NextResponse.json(
      {
        error: "Upgrade options are only allowed for Deals items.",
        errorCode: "non_deal_upgrade_options_not_allowed",
      },
      { status: 400 }
    );
  }
  if (isDeal) {
    const baseIssue = await validateProvidedDealBaseInput({
      itemInput,
      outletId,
      dealId: preGeneratedItemId ?? "__new_deal__",
    });
    if (baseIssue) {
      return NextResponse.json(
        { error: baseIssue.message, errorCode: baseIssue.code },
        { status: 400 }
      );
    }
  }

  const linkedMenuItemIds = [
    ...new Set(
      itemInput.upgradeOptions.flatMap((upgrade) =>
        upgrade.linkedItems
          .map((link) => link.linkedMenuItemId)
          .filter((linkId): linkId is string => linkId != null)
      )
    ),
  ];
  if (linkedMenuItemIds.length > 0) {
    const crossOutletLink = await prisma.menuItem.findFirst({
      where: {
        id: { in: linkedMenuItemIds },
        outletId: { not: outletId },
      },
      select: { id: true },
    });
    if (crossOutletLink) {
      return NextResponse.json(
        { error: "Upgrade linked items must belong to the same outlet" },
        { status: 400 }
      );
    }
  }

  // Enrich upgrade options outside the transaction so 400-class errors don't
  // start a partial DB write. self-reference check is irrelevant for create
  // since the parent item doesn't exist yet (parentItemId: null).
  const enriched = await enrichUpgradeOptions(itemInput.upgradeOptions, {
    parentItemId: preGeneratedItemId ?? null,
    existingUpgradeOptions: [],
    loadMenuItem: async (menuItemId) => {
      const row = await prisma.menuItem.findUnique({
        where: { id: menuItemId },
        select: {
          id: true,
          name: true,
          isActive: true,
          isOutOfStock: true,
          stockMode: true,
          stockQty: true,
          category: { select: { slug: true } },
          sizes: { select: { id: true, name: true } },
        },
      });
      return row;
    },
  });
  if (enriched.error) {
    return NextResponse.json({ error: enriched.error }, { status: 400 });
  }
  const enrichedUpgrades = enriched.value!;

  try {
    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.menuItem.create({
        data: {
          ...(preGeneratedItemId ? { id: preGeneratedItemId } : {}),
          outletId,
          categoryId: itemInput.categoryId,
          comboNum: itemInput.comboNum,
          name: itemInput.name,
          description: itemInput.description,
          price: new Prisma.Decimal(itemInput.price),
          emoji: itemInput.emoji,
          bgColor: itemInput.bgColor,
          badge: itemInput.badge,
          bundleSavings:
            itemInput.bundleSavings != null
              ? new Prisma.Decimal(itemInput.bundleSavings)
              : null,
          dealBaseMenuItemId: isDeal ? itemInput.dealBaseMenuItemId : null,
          dealBaseSizeId: isDeal ? itemInput.dealBaseSizeId : null,
          dealBaseSizeNameSnapshot: isDeal
            ? itemInput.dealBaseSizeNameSnapshot
            : null,
          dealStartsAt: isDeal ? itemInput.dealStartsAt : null,
          dealExpiresAt: isDeal ? itemInput.dealExpiresAt : null,
          dealLimitMode: isDeal ? itemInput.dealLimitMode : "UNLIMITED",
          dealLimitQty: initialDealLimitQty,
          dealLimitLowThreshold: initialDealLimitLowThreshold,
          dealLimitUpdatedAt: isDeal && itemInput.dealLimitMode === "LIMITED" ? now : null,
          dealLimitUpdatedById:
            isDeal && itemInput.dealLimitMode === "LIMITED" && actorUserId !== "legacy"
              ? actorUserId
              : null,
          imageUrl: itemInput.imageUrl,
          imageAlt: itemInput.imageAlt,
          imageFit: itemInput.imageFit,
          cardImageUrl: itemInput.cardImageUrl,
          cardImageAlt: itemInput.cardImageAlt,
          isActive: itemInput.isActive,
          isOutOfStock: persistedItemInput.isOutOfStock,
          stockMode: persistedItemInput.stockMode,
          stockQty: persistedItemInput.stockQty,
          lowStockThreshold: persistedItemInput.lowStockThreshold,
          stockUpdatedAt:
            persistedItemInput.stockMode === "QUANTITY" ? now : null,
          stockUpdatedById:
            persistedItemInput.stockMode === "QUANTITY" && actorUserId !== "legacy"
              ? actorUserId
              : null,
          sortOrder: itemInput.sortOrder,
        },
      });

      if (itemInput.sizes.length > 0) {
        await tx.sizeOption.createMany({
          data: itemInput.sizes.map((size, index) => ({
            itemId: item.id,
            name: size.name,
            priceDelta: new Prisma.Decimal(size.priceDelta),
            sortOrder: index,
          })),
        });
      }

      if (itemInput.addons.length > 0) {
        await tx.addonOption.createMany({
          data: itemInput.addons.map((addon, index) => ({
            itemId: item.id,
            name: addon.name,
            priceDelta: new Prisma.Decimal(addon.priceDelta),
            sortOrder: index,
          })),
        });
      }

      for (const upgrade of enrichedUpgrades) {
        const upgradeRow = await tx.upgradeOption.create({
          data: {
            ...(upgrade.id ? { id: upgrade.id } : {}),
            itemId: item.id,
            customTitle: upgrade.customTitle,
            extraCharge: new Prisma.Decimal(upgrade.extraCharge),
            savingsLabel:
              upgrade.savingsLabel != null
                ? new Prisma.Decimal(upgrade.savingsLabel)
                : null,
            discountPct:
              upgrade.discountPct != null
                ? new Prisma.Decimal(upgrade.discountPct)
                : null,
            sortOrder: upgrade.sortOrder,
          },
        });

        if (upgrade.linkedItems.length > 0) {
          await tx.upgradeItemLink.createMany({
            data: upgrade.linkedItems.map((link, linkIndex) => ({
              ...(link.id ? { id: link.id } : {}),
              upgradeOptionId: upgradeRow.id,
              linkedMenuItemId: link.linkedMenuItemId,
              linkedSizeId: link.linkedSizeId,
              itemNameSnapshot: link.itemNameSnapshot,
              sizeNameSnapshot: link.sizeNameSnapshot,
              sortOrder: link.sortOrder ?? linkIndex,
            })),
          });
        }
      }

      await refreshDealVisibility(tx, outletId);

      const createdItem = await tx.menuItem.findUniqueOrThrow({
        where: { id: item.id },
        include: ITEM_INCLUDE,
      });

      if (persistedItemInput.stockMode === "QUANTITY") {
        await recordAdminStockMovement(tx, {
          outletId,
          menuItemId: createdItem.id,
          itemNameSnapshot: createdItem.name,
          before: null,
          after: {
            stockMode: createdItem.stockMode,
            stockQty: createdItem.stockQty,
          },
          actor: {
            actorType: actorUserId === "legacy" ? "ADMIN_BASIC" : "ADMIN_USER",
            actorId: actorUserId === "legacy" ? null : actorUserId,
          },
          note: "Initial quantity tracking setup.",
        });
      }

      await writeMenuAuditAndRevision(tx, {
        actionType: "ITEM_CREATED",
        targetType: "ITEM",
        outletId,
        targetId: createdItem.id,
        targetLabel: createdItem.name,
        afterPayload: itemSnapshotFromRecord(createdItem),
      });

      return createdItem;
    });

    return NextResponse.json(serializeItem(created), { status: 201 });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json({ error: "Category not found" }, { status: 400 });
    }
    return NextResponse.json({ error: "Item create failed" }, { status: 500 });
  }
}
