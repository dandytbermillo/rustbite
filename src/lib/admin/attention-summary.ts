import "server-only";
import { prisma } from "@/lib/db";
import {
  adminActorHasPermission,
  type AdminSessionActor,
} from "@/lib/admin-sessions";
import {
  resolveAdminActiveOutlet,
  type AdminActiveOutletResolution,
} from "@/lib/admin-active-outlet";
import {
  buildMatchContext,
  dealNeedsAttention,
  nonDealInventoryLowNeedsAttention,
  nonDealInventoryOutNeedsAttention,
} from "@/lib/admin/filters/match";
import type { Cat, Item } from "@/lib/admin/menu/visibility";
import type { ImageFit } from "@/lib/types";

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

export type AdminAttentionSeverity = "critical" | "warning" | "info";

export type AdminAttentionSummary = {
  generatedAt: string;
  outletId: string;
  outletName: string;
  totalCount: number;
  groups: Array<{
    id: "menu" | "orders";
    label: string;
    count: number;
    items: Array<{
      id: string;
      label: string;
      count: number;
      severity: AdminAttentionSeverity;
      href: string;
    }>;
  }>;
};

export type AdminAttentionSummaryResult =
  | { ok: true; summary: AdminAttentionSummary }
  | {
      ok: false;
      status: 403 | 409;
      body: { error: string; errorCode: string };
    };

function normalizeImageFit(value: string | null | undefined): ImageFit {
  return value === "CONTAIN" ? "CONTAIN" : "COVER";
}

async function loadAdminMenuAttentionRows(outletId: string): Promise<{
  categories: Cat[];
  items: Item[];
}> {
  const [categories, items] = await Promise.all([
    prisma.category.findMany({
      where: { outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.menuItem.findMany({
      where: { outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
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
                    lowStockThreshold: true,
                    price: true,
                    sizes: { select: { id: true } },
                  },
                },
                linkedSize: {
                  select: { id: true, name: true, priceDelta: true },
                },
              },
            },
          },
        },
      },
    }),
  ]);

  const categoryRows: Cat[] = categories.map((category) => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
    icon: category.icon,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    updatedAt: category.updatedAt.toISOString(),
  }));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const itemRows: Item[] = items.map((item) => {
    const isDeal = categoryById.get(item.categoryId)?.slug === "deals";
    const upgradeOptions = isDeal ? item.upgradeOptions : [];

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
                lowStockThreshold: link.linkedMenuItem.lowStockThreshold,
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
  });

  return { categories: categoryRows, items: itemRows };
}

function activeOutletError(
  activeOutlet: Exclude<AdminActiveOutletResolution, { status: "active" }>,
): AdminAttentionSummaryResult {
  if (activeOutlet.status === "needs_picker") {
    return {
      ok: false,
      status: 409,
      body: {
        error: "Choose an outlet first",
        errorCode: "active_outlet_required",
      },
    };
  }

  return {
    ok: false,
    status: 403,
    body: {
      error: "No outlet access",
      errorCode: "no_outlet_access",
    },
  };
}

export async function loadAdminAttentionSummary({
  session,
  cookies,
}: {
  session: AdminSessionActor;
  cookies: CookieReader;
}): Promise<AdminAttentionSummaryResult> {
  const activeOutlet = await resolveAdminActiveOutlet(session, cookies);
  if (activeOutlet.status !== "active") return activeOutletError(activeOutlet);

  const [canReadMenu, canReadOrders] = await Promise.all([
    adminActorHasPermission(session, "admin.menu.read", activeOutlet.outletId),
    adminActorHasPermission(session, "admin.orders.read", activeOutlet.outletId),
  ]);

  const generatedAt = new Date();
  const groups: AdminAttentionSummary["groups"] = [];

  if (canReadMenu) {
    const { categories, items } = await loadAdminMenuAttentionRows(
      activeOutlet.outletId,
    );
    const matchContext = buildMatchContext(
      items,
      categories,
      generatedAt.getTime(),
    );
    const dealsNeedAttention = items.filter((item) => {
      const category = matchContext.categoryById.get(item.categoryId);
      return category ? dealNeedsAttention(item, category, matchContext) : false;
    }).length;
    const inventoryOut = items.filter((item) => {
      const category = matchContext.categoryById.get(item.categoryId);
      return category
        ? nonDealInventoryOutNeedsAttention(item, category)
        : false;
    }).length;
    const inventoryLow = items.filter((item) => {
      const category = matchContext.categoryById.get(item.categoryId);
      return category
        ? nonDealInventoryLowNeedsAttention(item, category)
        : false;
    }).length;

    const menuItems = [
      {
        id: "deals",
        label: "deals need attention",
        count: dealsNeedAttention,
        severity: "critical" as const,
        href: "/admin/menu?attention=deals",
      },
      {
        id: "inventory-out",
        label: "items out of stock",
        count: inventoryOut,
        severity: "warning" as const,
        href: "/admin/menu?attention=inventory-out",
      },
      {
        id: "inventory-low",
        label: "low-stock items",
        count: inventoryLow,
        severity: "warning" as const,
        href: "/admin/menu?attention=inventory-low",
      },
    ].filter((item) => item.count > 0);

    groups.push({
      id: "menu",
      label: "Menu",
      count: menuItems.reduce((sum, item) => sum + item.count, 0),
      items: menuItems,
    });
  }

  if (canReadOrders) {
    const orderCounts = await prisma.order.groupBy({
      by: ["status"],
      where: {
        outletId: activeOutlet.outletId,
        status: { in: ["AWAITING_COUNTER_PAYMENT", "READY"] },
      },
      _count: { _all: true },
    });
    const findCount = (status: string) =>
      orderCounts.find((row) => row.status === status)?._count._all ?? 0;
    const awaitingPayment = findCount("AWAITING_COUNTER_PAYMENT");
    const ready = findCount("READY");
    const orderItems = [
      {
        id: "awaiting-payment",
        label: "orders awaiting payment",
        count: awaitingPayment,
        severity: "info" as const,
        href: "/admin/orders?status=AWAITING_COUNTER_PAYMENT",
      },
      {
        id: "ready",
        label: "orders ready for pickup",
        count: ready,
        severity: "info" as const,
        href: "/admin/orders?status=READY",
      },
    ].filter((item) => item.count > 0);

    groups.push({
      id: "orders",
      label: "Orders",
      count: orderItems.reduce((sum, item) => sum + item.count, 0),
      items: orderItems,
    });
  }

  return {
    ok: true,
    summary: {
      generatedAt: generatedAt.toISOString(),
      outletId: activeOutlet.outletId,
      outletName: activeOutlet.outletName,
      groups,
      totalCount: groups.reduce((sum, group) => sum + group.count, 0),
    },
  };
}
