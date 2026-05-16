import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import {
  requireAdminApiPermission,
  requireAdminApiPermissionContext,
} from "@/lib/admin-sessions";
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
import {
  itemSnapshotFromRecord,
  writeMenuAuditAndRevision,
} from "@/lib/menu-history";
import {
  type AdminItemInput,
  type AdminModifierInput,
  type EnrichedUpgradeOption,
  enrichUpgradeOptions,
  normalizeDealShellStockInput,
  preserveManualItemStockInput,
  parseMenuItemLockVersion,
  validateItemInput,
} from "@/lib/menu-admin";
import {
  recordAdminStockMovement,
  stockTrackingChanged,
} from "@/lib/menu-stock-movements";
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

const MODIFIER_CONFLICT_ERROR =
  "Modifier options changed while this editor was open. Reload and try again.";
const ITEM_CONFLICT_ERROR = "Item changed since you opened it. Reload and try again.";

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

async function validateSubmittedDealLinks({
  itemInput,
  outletId,
}: {
  itemInput: AdminItemInput;
  outletId: string;
}) {
  const links = itemInput.upgradeOptions.flatMap((upgrade) => upgrade.linkedItems);
  const linkedMenuItemIds = [
    ...new Set(
      links
        .map((link) => link.linkedMenuItemId)
        .filter((linkId): linkId is string => linkId != null)
    ),
  ];

  const linkedItems =
    linkedMenuItemIds.length > 0
      ? await prisma.menuItem.findMany({
          where: { id: { in: linkedMenuItemIds } },
          select: {
            id: true,
            name: true,
            outletId: true,
            category: { select: { slug: true } },
            sizes: { select: { id: true } },
          },
        })
      : [];
  const linkedItemById = new Map(linkedItems.map((item) => [item.id, item]));

  for (const [upgradeIndex, upgrade] of itemInput.upgradeOptions.entries()) {
    for (const [linkIndex, link] of upgrade.linkedItems.entries()) {
      const label = `upgrade option ${upgradeIndex + 1} linked item ${
        linkIndex + 1
      }`;
      if (!link.linkedMenuItemId) {
        return {
          error: `${label} must reference a menu item. Replace or remove it before saving.`,
          errorCode: "deal_requires_repair",
        };
      }

      const linkedItem = linkedItemById.get(link.linkedMenuItemId);
      if (!linkedItem) {
        return {
          error: `${label} references a missing menu item. Replace or remove it before saving.`,
          errorCode: "deal_requires_repair",
        };
      }
      if (linkedItem.outletId !== outletId) {
        return {
          error: `${label} belongs to a different outlet.`,
          errorCode: "deal_link_outlet_mismatch",
        };
      }
      if (linkedItem.category.slug === "deals") {
        return {
          error:
            "Deal upgrade options cannot reference another deal. Replace or remove the linked deal first.",
          errorCode: "nested_deal_link_not_allowed",
        };
      }
      if (
        link.linkedSizeId &&
        !linkedItem.sizes.some((size) => size.id === link.linkedSizeId)
      ) {
        return {
          error: `${label} references an invalid size. Replace or remove it before saving.`,
          errorCode: "deal_requires_repair",
        };
      }
      if (!link.linkedSizeId && linkedItem.sizes.length > 0) {
        return {
          error: `${label} must choose a size. Replace or remove it before saving.`,
          errorCode: "deal_requires_repair",
        };
      }
    }
  }

  return null;
}

class ModifierPayloadConflict extends Error {
  constructor(message = MODIFIER_CONFLICT_ERROR) {
    super(message);
    this.name = "ModifierPayloadConflict";
  }
}

class ItemVersionConflict extends Error {
  constructor(message = ITEM_CONFLICT_ERROR) {
    super(message);
    this.name = "ItemVersionConflict";
  }
}

function assertUniqueModifierIds(
  rows: AdminModifierInput[],
  label: string
) {
  const ids = rows.map((row) => row.id).filter((id): id is string => !!id);
  if (new Set(ids).size !== ids.length) {
    throw new ModifierPayloadConflict(`${label} payload is invalid. Reload and try again.`);
  }
}

async function syncSizeOptions(
  tx: Prisma.TransactionClient,
  itemId: string,
  rows: AdminModifierInput[]
) {
  assertUniqueModifierIds(rows, "Size");
  const existing = await tx.sizeOption.findMany({
    where: { itemId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((row) => row.id));
  const keepIds = new Set<string>();

  for (const [index, row] of rows.entries()) {
    if (row.id) {
      if (!existingIds.has(row.id)) {
        throw new ModifierPayloadConflict();
      }

      const updated = await tx.sizeOption.updateMany({
        where: { id: row.id, itemId },
        data: {
          name: row.name,
          priceDelta: new Prisma.Decimal(row.priceDelta),
          sortOrder: index,
        },
      });

      if (updated.count !== 1) {
        throw new ModifierPayloadConflict();
      }

      keepIds.add(row.id);
      continue;
    }

    await tx.sizeOption.create({
      data: {
        itemId,
        name: row.name,
        priceDelta: new Prisma.Decimal(row.priceDelta),
        sortOrder: index,
      },
    });
  }

  const idsToDelete = existing
    .map((row) => row.id)
    .filter((existingId) => !keepIds.has(existingId));
  if (idsToDelete.length > 0) {
    await tx.sizeOption.deleteMany({
      where: { itemId, id: { in: idsToDelete } },
    });
  }
}

async function syncAddonOptions(
  tx: Prisma.TransactionClient,
  itemId: string,
  rows: AdminModifierInput[]
) {
  assertUniqueModifierIds(rows, "Add-on");
  const existing = await tx.addonOption.findMany({
    where: { itemId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((row) => row.id));
  const keepIds = new Set<string>();

  for (const [index, row] of rows.entries()) {
    if (row.id) {
      if (!existingIds.has(row.id)) {
        throw new ModifierPayloadConflict();
      }

      const updated = await tx.addonOption.updateMany({
        where: { id: row.id, itemId },
        data: {
          name: row.name,
          priceDelta: new Prisma.Decimal(row.priceDelta),
          sortOrder: index,
        },
      });

      if (updated.count !== 1) {
        throw new ModifierPayloadConflict();
      }

      keepIds.add(row.id);
      continue;
    }

    await tx.addonOption.create({
      data: {
        itemId,
        name: row.name,
        priceDelta: new Prisma.Decimal(row.priceDelta),
        sortOrder: index,
      },
    });
  }

  const idsToDelete = existing
    .map((row) => row.id)
    .filter((existingId) => !keepIds.has(existingId));
  if (idsToDelete.length > 0) {
    await tx.addonOption.deleteMany({
      where: { itemId, id: { in: idsToDelete } },
    });
  }
}

async function syncUpgradeOptions(
  tx: Prisma.TransactionClient,
  itemId: string,
  rows: EnrichedUpgradeOption[]
) {
  // delete-then-upsert by id, mirroring syncSizeOptions/syncAddonOptions and
  // the snapshot/restore pattern (menu-history.ts). Stable ids ride through
  // for cart-side selectedUpgradeOptionId references.
  const existingUpgrades = await tx.upgradeOption.findMany({
    where: { itemId },
    select: {
      id: true,
      linkedItems: { select: { id: true } },
    },
  });
  const existingUpgradeIds = new Set(existingUpgrades.map((u) => u.id));
  const keepUpgradeIds = new Set<string>();

  for (const upgrade of rows) {
    if (upgrade.id && existingUpgradeIds.has(upgrade.id)) {
      await tx.upgradeOption.update({
        where: { id: upgrade.id },
        data: {
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
      keepUpgradeIds.add(upgrade.id);
    } else {
      const created = await tx.upgradeOption.create({
        data: {
          ...(upgrade.id ? { id: upgrade.id } : {}),
          itemId,
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
      keepUpgradeIds.add(created.id);
      upgrade.id = created.id; // capture for link upserts below
    }

    // Sync this upgrade's links: delete absent, upsert by id.
    const existingLinkRows =
      existingUpgrades.find((u) => u.id === upgrade.id)?.linkedItems ?? [];
    const existingLinkIds = new Set(existingLinkRows.map((l) => l.id));
    const keepLinkIds = new Set<string>();

    for (const [linkIndex, link] of upgrade.linkedItems.entries()) {
      const linkSortOrder = link.sortOrder ?? linkIndex;
      if (link.id && existingLinkIds.has(link.id)) {
        await tx.upgradeItemLink.update({
          where: { id: link.id },
          data: {
            linkedMenuItemId: link.linkedMenuItemId,
            linkedSizeId: link.linkedSizeId,
            itemNameSnapshot: link.itemNameSnapshot,
            sizeNameSnapshot: link.sizeNameSnapshot,
            sortOrder: linkSortOrder,
          },
        });
        keepLinkIds.add(link.id);
      } else {
        const created = await tx.upgradeItemLink.create({
          data: {
            ...(link.id ? { id: link.id } : {}),
            upgradeOptionId: upgrade.id,
            linkedMenuItemId: link.linkedMenuItemId,
            linkedSizeId: link.linkedSizeId,
            itemNameSnapshot: link.itemNameSnapshot,
            sizeNameSnapshot: link.sizeNameSnapshot,
            sortOrder: linkSortOrder,
          },
        });
        keepLinkIds.add(created.id);
      }
    }

    const linksToDelete = existingLinkRows
      .map((l) => l.id)
      .filter((id) => !keepLinkIds.has(id));
    if (linksToDelete.length > 0) {
      await tx.upgradeItemLink.deleteMany({
        where: { upgradeOptionId: upgrade.id, id: { in: linksToDelete } },
      });
    }
  }

  const upgradesToDelete = existingUpgrades
    .map((u) => u.id)
    .filter((id) => !keepUpgradeIds.has(id));
  if (upgradesToDelete.length > 0) {
    await tx.upgradeOption.deleteMany({
      where: { itemId, id: { in: upgradesToDelete } },
    });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const item = await prisma.menuItem.findUnique({
    where: { id },
    include: ITEM_INCLUDE,
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const authError = await requireAdminApiPermission(
    req,
    "admin.menu.read",
    item.outletId
  );
  if (authError) return authError;

  return NextResponse.json(serializeItem(item));
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existingScope = await prisma.menuItem.findUnique({
    where: { id },
    select: { id: true, outletId: true },
  });
  if (!existingScope) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const auth = await requireAdminApiPermissionContext(
    req,
    "admin.menu.write",
    existingScope.outletId
  );
  if (!auth.ok) return auth.response;

  const contentType = (req.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.startsWith("multipart/form-data")) {
    return handleMultipartPatch(
      req,
      id,
      existingScope.outletId,
      auth.context.actor.userId
    );
  }
  return handleJsonPatch(req, id, existingScope.outletId, auth.context.actor.userId);
}

async function handleJsonPatch(
  req: NextRequest,
  id: string,
  currentOutletId: string,
  actorUserId: string
) {
  const raw = await req.json().catch(() => null);
  const existingItem = await prisma.menuItem.findUnique({
    where: { id },
    select: {
      id: true,
      lockVersion: true,
      updatedAt: true,
      outletId: true,
      category: { select: { slug: true } },
    },
  });
  if (!existingItem) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (existingItem.outletId !== currentOutletId) {
    return NextResponse.json({ error: "Item outlet changed" }, { status: 409 });
  }

  const version = parseMenuItemLockVersion(raw);
  if (version.error) {
    return NextResponse.json({ error: version.error }, { status: 400 });
  }
  if (existingItem.lockVersion !== version.value) {
    return NextResponse.json({ error: ITEM_CONFLICT_ERROR }, { status: 409 });
  }

  const allowedImageHosts = resolveAllowedImageHosts(
    process.env.NEXT_PUBLIC_IMAGE_CDN_BASE,
    process.env.IMAGE_PASTE_URL_ALLOWLIST
  );
  const validation = validateItemInput(raw, { allowedImageHosts });
  if (!validation.value) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const itemInput = validation.value;

  return runItemUpdate(
    id,
    existingItem.lockVersion,
    itemInput,
    currentOutletId,
    actorUserId
  );
}

async function handleMultipartPatch(
  req: NextRequest,
  id: string,
  currentOutletId: string,
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

  const version = parseMenuItemLockVersion(rawItem);
  if (version.error) {
    return NextResponse.json({ error: version.error }, { status: 400 });
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

  // Stale-save pre-check before any image processing — otherwise a stale PATCH
  // would re-encode through sharp and write files to disk before discovering
  // the 409 inside the transaction, orphaning the files. imageUrl is retained
  // so downstream code can short-circuit the no-op no-heroFile case.
  const existingItem = await prisma.menuItem.findUnique({
    where: { id },
    select: {
      id: true,
      lockVersion: true,
      updatedAt: true,
      imageUrl: true,
      outletId: true,
      category: { select: { slug: true } },
    },
  });
  if (!existingItem) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }
  if (existingItem.outletId !== currentOutletId) {
    return NextResponse.json({ error: "Item outlet changed" }, { status: 409 });
  }
  if (existingItem.lockVersion !== version.value) {
    return NextResponse.json({ error: ITEM_CONFLICT_ERROR }, { status: 409 });
  }

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

  if (heroFileBuffer) {
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
        itemId: id,
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

  // Legacy card-image override must not survive a hero-only save — force null
  // so the persisted row matches the current UI's hero-is-the-card model.
  itemInput.cardImageUrl = null;
  itemInput.cardImageAlt = null;

  return runItemUpdate(
    id,
    existingItem.lockVersion,
    itemInput,
    currentOutletId,
    actorUserId
  );
}

async function runItemUpdate(
  id: string,
  expectedLockVersion: number,
  itemInput: AdminItemInput,
  currentOutletId: string,
  actorUserId: string
) {
  const category = await prisma.category.findUnique({
    where: { id: itemInput.categoryId },
    select: { id: true, slug: true, outletId: true },
  });
  if (!category) {
    return NextResponse.json({ error: "Category not found" }, { status: 400 });
  }
  if (category.outletId !== currentOutletId) {
    return NextResponse.json(
      { error: "Category belongs to a different outlet" },
      { status: 400 }
    );
  }
  const isDeal = category.slug === "deals";
  const requestedItemInput = normalizeDealShellStockInput(itemInput, isDeal);
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
      outletId: currentOutletId,
      dealId: id,
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
  if (isDeal) {
    const linkIssue = await validateSubmittedDealLinks({
      itemInput,
      outletId: currentOutletId,
    });
    if (linkIssue) {
      return NextResponse.json(linkIssue, { status: 400 });
    }
  }
  if (linkedMenuItemIds.length > 0) {
    const crossOutletLink = await prisma.menuItem.findFirst({
      where: {
        id: { in: linkedMenuItemIds },
        outletId: { not: currentOutletId },
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
  if (isDeal && linkedMenuItemIds.length > 0) {
    const nestedDealLink = await prisma.menuItem.findFirst({
      where: {
        id: { in: linkedMenuItemIds },
        category: { slug: "deals" },
      },
      select: { id: true, name: true },
    });
    if (nestedDealLink) {
      return NextResponse.json(
        {
          error:
            "Deal upgrade options cannot reference another deal. Replace or remove the linked deal first.",
          errorCode: "nested_deal_link_not_allowed",
        },
        { status: 400 }
      );
    }
  }

  let enrichedUpgrades: EnrichedUpgradeOption[] = [];
  if (isDeal) {
    // Load existing upgrade options for the audit-window carve-out.
    const existingUpgrades = await prisma.upgradeOption.findMany({
      where: { itemId: id },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        customTitle: true,
        extraCharge: true,
        savingsLabel: true,
        discountPct: true,
        sortOrder: true,
        linkedItems: {
          orderBy: { sortOrder: "asc" },
          select: {
            id: true,
            linkedMenuItemId: true,
            linkedSizeId: true,
            itemNameSnapshot: true,
            sizeNameSnapshot: true,
            sortOrder: true,
          },
        },
      },
    });

    const enriched = await enrichUpgradeOptions(itemInput.upgradeOptions, {
      parentItemId: id,
      existingUpgradeOptions: existingUpgrades.map((u) => ({
        id: u.id,
        customTitle: u.customTitle,
        extraCharge: Number(u.extraCharge),
        savingsLabel: u.savingsLabel != null ? Number(u.savingsLabel) : null,
        discountPct: u.discountPct != null ? Number(u.discountPct) : null,
        sortOrder: u.sortOrder,
        linkedItems: u.linkedItems.map((l) => ({
          id: l.id,
          linkedMenuItemId: l.linkedMenuItemId,
          linkedSizeId: l.linkedSizeId,
          itemNameSnapshot: l.itemNameSnapshot,
          sizeNameSnapshot: l.sizeNameSnapshot,
          sortOrder: l.sortOrder,
        })),
      })),
      loadMenuItem: async (menuItemId) =>
        prisma.menuItem.findUnique({
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
        }),
    });
    if (enriched.error) {
      return NextResponse.json({ error: enriched.error }, { status: 400 });
    }
    enrichedUpgrades = enriched.value!;
  }

  try {
    const updated = await prisma.$transaction(async (tx) => {
      const beforeItem = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        include: ITEM_INCLUDE,
      });
      const persistedItemInput = preserveManualItemStockInput(
        requestedItemInput,
        {
          stockMode: beforeItem.stockMode,
          isOutOfStock: beforeItem.isOutOfStock,
          stockQty: beforeItem.stockQty,
          lowStockThreshold: beforeItem.lowStockThreshold,
        },
        isDeal
      );
      const persistedDealLimitQty =
        isDeal && itemInput.dealLimitMode === "UNLIMITED"
          ? beforeItem.dealLimitQty
          : itemInput.dealLimitQty;
      const persistedDealLimitLowThreshold = isDeal
        ? itemInput.dealLimitLowThreshold
        : null;
      const dealLimitChanged =
        isDeal &&
        (beforeItem.dealLimitMode !== itemInput.dealLimitMode ||
          beforeItem.dealLimitQty !== persistedDealLimitQty ||
          beforeItem.dealLimitLowThreshold !== persistedDealLimitLowThreshold);
      const now = new Date();
      const data: Prisma.MenuItemUncheckedUpdateInput = {
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
        dealLimitQty: isDeal ? persistedDealLimitQty : null,
        dealLimitLowThreshold: persistedDealLimitLowThreshold,
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
        sortOrder: itemInput.sortOrder,
        categoryId: itemInput.categoryId,
        updatedAt: now,
      };
      const stockChanged = !isDeal && stockTrackingChanged(
        {
          stockMode: beforeItem.stockMode,
          stockQty: beforeItem.stockQty,
        },
        {
          stockMode: persistedItemInput.stockMode,
          stockQty: persistedItemInput.stockQty,
        }
      );
      const updateData: Prisma.MenuItemUncheckedUpdateInput = {
        ...data,
        ...(dealLimitChanged
          ? {
              dealLimitUpdatedAt: now,
              dealLimitUpdatedById:
                actorUserId === "legacy" ? null : actorUserId,
            }
          : {}),
        ...(stockChanged
          ? {
              stockUpdatedAt: now,
              stockUpdatedById:
                actorUserId === "legacy" ? null : actorUserId,
            }
          : {}),
      };

      const touched = await tx.menuItem.updateMany({
        where: { id, lockVersion: expectedLockVersion },
        data: {
          ...updateData,
          lockVersion: { increment: 1 },
        },
      });
      if (touched.count !== 1) {
        throw new ItemVersionConflict();
      }
      await syncSizeOptions(tx, id, itemInput.sizes);
      await syncAddonOptions(tx, id, itemInput.addons);
      if (isDeal) {
        await syncUpgradeOptions(tx, id, enrichedUpgrades);
      } else {
        await tx.upgradeOption.deleteMany({ where: { itemId: id } });
      }
      await refreshDealVisibility(tx, currentOutletId);

      const refreshed = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        include: ITEM_INCLUDE,
      });

      if (!isDeal) {
        await recordAdminStockMovement(tx, {
          outletId: currentOutletId,
          menuItemId: refreshed.id,
          itemNameSnapshot: refreshed.name,
          before: {
            stockMode: beforeItem.stockMode,
            stockQty: beforeItem.stockQty,
          },
          after: {
            stockMode: refreshed.stockMode,
            stockQty: refreshed.stockQty,
          },
          actor: {
            actorType: actorUserId === "legacy" ? "ADMIN_BASIC" : "ADMIN_USER",
            actorId: actorUserId === "legacy" ? null : actorUserId,
          },
        });
      }

      await writeMenuAuditAndRevision(tx, {
        actionType: "ITEM_UPDATED",
        targetType: "ITEM",
        outletId: currentOutletId,
        targetId: refreshed.id,
        targetLabel: refreshed.name,
        beforePayload: itemSnapshotFromRecord(beforeItem),
        afterPayload: itemSnapshotFromRecord(refreshed),
      });

      return refreshed;
    });

    return NextResponse.json(serializeItem(updated));
  } catch (err) {
    if (err instanceof ItemVersionConflict) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof ModifierPayloadConflict) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json({ error: "Category not found" }, { status: 400 });
    }
    return NextResponse.json({ error: "Item update failed" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const existingItem = await prisma.menuItem.findUnique({
    where: { id },
    select: { id: true, lockVersion: true, updatedAt: true, outletId: true },
  });
  if (!existingItem) {
    return NextResponse.json({ error: "Item not found" }, { status: 404 });
  }

  const authError = await requireAdminApiPermission(
    req,
    "admin.menu.write",
    existingItem.outletId
  );
  if (authError) return authError;

  const raw = await req.json().catch(() => null);
  const version = parseMenuItemLockVersion(raw);
  if (version.error) {
    return NextResponse.json({ error: version.error }, { status: 400 });
  }
  if (existingItem.lockVersion !== version.value) {
    return NextResponse.json({ error: ITEM_CONFLICT_ERROR }, { status: 409 });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const beforeItem = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        include: ITEM_INCLUDE,
      });

      const updated = await tx.menuItem.updateMany({
        where: { id, lockVersion: existingItem.lockVersion },
        data: {
          isActive: false,
          lockVersion: { increment: 1 },
          updatedAt: new Date(),
        },
      });
      if (updated.count !== 1) {
        const current = await tx.menuItem.findUnique({
          where: { id },
          select: { id: true },
        });
        return { ok: false as const, exists: !!current };
      }

      const afterItem = await tx.menuItem.findUniqueOrThrow({
        where: { id },
        include: ITEM_INCLUDE,
      });

      await writeMenuAuditAndRevision(tx, {
        actionType: "ITEM_HIDDEN",
        targetType: "ITEM",
        outletId: existingItem.outletId,
        targetId: beforeItem.id,
        targetLabel: beforeItem.name,
        beforePayload: itemSnapshotFromRecord(beforeItem),
        afterPayload: itemSnapshotFromRecord(afterItem),
      });

      return { ok: true as const };
    });

    if (!result.ok) {
      return NextResponse.json(
        { error: result.exists ? ITEM_CONFLICT_ERROR : "Item not found" },
        { status: result.exists ? 409 : 404 }
      );
    }
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json({ error: "Item delete failed" }, { status: 500 });
  }
}
