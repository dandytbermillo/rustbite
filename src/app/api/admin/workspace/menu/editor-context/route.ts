import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireAdminApiSessionPermissionContext } from "@/lib/admin-sessions";
import { getAppSettings } from "@/lib/app-settings";
import { prisma } from "@/lib/db";
import { resolveAllowedImageHosts } from "@/lib/image-urls";
import {
  ITEM_MODIFIER_LINK_INCLUDE,
  SHARED_MODIFIER_GROUP_INCLUDE,
  serializeItemModifierGroupLink,
  serializeSharedModifierGroup,
} from "@/lib/admin/shared-modifier-routes";
import type { ImageFit } from "@/lib/types";
import { withObservability } from "@/lib/observability/route-context";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ITEM_INCLUDE = {
  sizes: { orderBy: { sortOrder: "asc" } },
  addons: { orderBy: { sortOrder: "asc" } },
  modifierGroupLinks: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    include: ITEM_MODIFIER_LINK_INCLUDE,
  },
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

function jsonNoStore(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("cache-control", "no-store");
  return response;
}

function normalizeImageFit(value: string | null | undefined): ImageFit {
  return value === "CONTAIN" ? "CONTAIN" : "COVER";
}

function serializeItem(
  item: Prisma.MenuItemGetPayload<{ include: typeof ITEM_INCLUDE }>,
  categorySlug: string | undefined,
) {
  const upgradeOptions = categorySlug === "deals" ? item.upgradeOptions : [];
  return {
    id: item.id,
    categoryId: item.categoryId,
    comboNum: item.comboNum,
    name: item.name,
    description: item.description,
    price: Number(item.price),
    emoji: item.emoji,
    bgColor: item.bgColor,
    badge: item.badge,
    bundleSavings:
      item.bundleSavings != null
        ? Number(item.bundleSavings)
        : item.mealSavings != null
          ? Number(item.mealSavings)
          : null,
    dealBaseMenuItemId: item.dealBaseMenuItemId,
    dealBaseSizeId: item.dealBaseSizeId,
    dealBaseSizeNameSnapshot: item.dealBaseSizeNameSnapshot,
    dealStartsAt: item.dealStartsAt?.toISOString() ?? null,
    dealExpiresAt: item.dealExpiresAt?.toISOString() ?? null,
    dealLimitMode: item.dealLimitMode,
    dealLimitQty: item.dealLimitQty,
    dealLimitLowThreshold: item.dealLimitLowThreshold,
    dealLimitUpdatedAt: item.dealLimitUpdatedAt?.toISOString() ?? null,
    dealLimitUpdatedById: item.dealLimitUpdatedById,
    imageUrl: item.imageUrl,
    imageAlt: item.imageAlt,
    imageFit: normalizeImageFit(item.imageFit),
    cardImageUrl: item.cardImageUrl,
    cardImageAlt: item.cardImageAlt,
    isActive: item.isActive,
    isOutOfStock: item.isOutOfStock,
    stockMode: item.stockMode,
    stockQty: item.stockQty,
    lowStockThreshold: item.lowStockThreshold,
    stockUpdatedAt: item.stockUpdatedAt?.toISOString() ?? null,
    stockUpdatedById: item.stockUpdatedById,
    sortOrder: item.sortOrder,
    lockVersion: item.lockVersion,
    updatedAt: item.updatedAt.toISOString(),
    modifierContractMode: item.modifierContractMode,
    modifierGroupLinks: item.modifierGroupLinks.map(serializeItemModifierGroupLink),
    sizes: item.sizes.map((size) => ({
      id: size.id,
      name: size.name,
      priceDelta: Number(size.priceDelta),
    })),
    addons: item.addons.map((addon) => ({
      id: addon.id,
      name: addon.name,
      priceDelta: Number(addon.priceDelta),
    })),
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
  return withObservability(req, async (req, _obsCtx) => {
  const auth = await requireAdminApiSessionPermissionContext(
    req,
    "admin.menu.write",
  );
  if (!auth.ok) {
    auth.response.headers.set("cache-control", "no-store");
    return auth.response;
  }

  const [categories, items, modifierGroups, appSettings] = await Promise.all([
    prisma.category.findMany({
      where: { outletId: auth.context.outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.menuItem.findMany({
      where: { outletId: auth.context.outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: ITEM_INCLUDE,
    }),
    prisma.sharedModifierGroup.findMany({
      where: { outletId: auth.context.outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: SHARED_MODIFIER_GROUP_INCLUDE,
    }),
    getAppSettings(),
  ]);

  const modifierGroupIds = modifierGroups.map((group) => group.id);
  const [
    totalItemLinkCounts,
    activeItemLinkCounts,
    attachmentHistoryCounts,
    optionOverrideRows,
  ] =
    modifierGroupIds.length > 0
      ? await Promise.all([
          prisma.menuItemModifierGroup.groupBy({
            by: ["modifierGroupId"],
            where: {
              outletId: auth.context.outletId,
              modifierGroupId: { in: modifierGroupIds },
            },
            _count: { _all: true },
          }),
          prisma.menuItemModifierGroup.groupBy({
            by: ["modifierGroupId"],
            where: {
              outletId: auth.context.outletId,
              modifierGroupId: { in: modifierGroupIds },
              isActive: true,
            },
            _count: { _all: true },
          }),
          prisma.menuItemModifierGroupAttachmentHistory.groupBy({
            by: ["modifierGroupId"],
            where: {
              outletId: auth.context.outletId,
              modifierGroupId: { in: modifierGroupIds },
            },
            _count: { _all: true },
          }),
          prisma.menuItemModifierOptionOverride.findMany({
            where: {
              itemModifierGroup: {
                outletId: auth.context.outletId,
                modifierGroupId: { in: modifierGroupIds },
              },
            },
            select: {
              itemModifierGroup: {
                select: { modifierGroupId: true },
              },
            },
          }),
        ])
      : [[], [], [], []];

  const totalItemLinkCountByGroup = new Map(
    totalItemLinkCounts.map((entry) => [entry.modifierGroupId, entry._count._all]),
  );
  const activeItemLinkCountByGroup = new Map(
    activeItemLinkCounts.map((entry) => [entry.modifierGroupId, entry._count._all]),
  );
  const attachmentHistoryCountByGroup = new Map(
    attachmentHistoryCounts.map((entry) => [entry.modifierGroupId, entry._count._all]),
  );
  const optionOverrideCountByGroup = new Map<string, number>();
  for (const row of optionOverrideRows) {
    const groupId = row.itemModifierGroup.modifierGroupId;
    optionOverrideCountByGroup.set(
      groupId,
      (optionOverrideCountByGroup.get(groupId) ?? 0) + 1,
    );
  }

  const categoryById = new Map(categories.map((category) => [category.id, category]));
  return jsonNoStore({
    categories: categories.map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      icon: category.icon,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
    })),
    items: items.map((item) => serializeItem(item, categoryById.get(item.categoryId)?.slug)),
    modifierGroups: modifierGroups.map((group) => {
      const totalItemLinkCount = totalItemLinkCountByGroup.get(group.id) ?? 0;
      const attachmentHistoryCount =
        attachmentHistoryCountByGroup.get(group.id) ?? 0;
      const optionOverrideCount = optionOverrideCountByGroup.get(group.id) ?? 0;
      return {
        ...serializeSharedModifierGroup(group),
        activeItemLinkCount: activeItemLinkCountByGroup.get(group.id) ?? 0,
        totalItemLinkCount,
        attachmentHistoryCount,
        optionOverrideCount,
        canHardDelete:
          totalItemLinkCount === 0 &&
          attachmentHistoryCount === 0 &&
          optionOverrideCount === 0,
      };
    }),
    allowedImageHosts: resolveAllowedImageHosts(
      process.env.NEXT_PUBLIC_IMAGE_CDN_BASE,
      process.env.IMAGE_PASTE_URL_ALLOWLIST,
    ),
    dealDefaultDiscountPct: appSettings.dealDefaultDiscountPct,
  });
  });
}
