import { NextRequest, NextResponse } from "next/server";
import { hasValidAdminAuth } from "@/lib/admin-auth";
import { getAdminSessionFromRequest } from "@/lib/admin-sessions";
import { getDeviceMenuOutletId } from "@/lib/device-menu-outlet";
import { getDeviceSessionFromRequest } from "@/lib/device-sessions";
import { prisma } from "@/lib/db";
import {
  getCompleteDealUpgradeLinks,
  isDealCustomerVisible,
  isStrictDealBaseEnforcementEnabled,
} from "@/lib/deal-base-validation";
import { validateDealSchedule } from "@/lib/deal-schedule";
import { DEFAULT_OUTLET_ID } from "@/lib/outlets";
import { getOutletMenuVersion } from "@/lib/outlet-menu-sync";
import type { ImageFit, UpgradeLinkedItemDTO, UpgradeOptionDTO } from "@/lib/types";
import { isMenuItemAvailable } from "@/lib/menu-availability";
import { getRenderableUpgradeLinks } from "@/lib/upgrade-renderability";
import {
  blocksCustomerOrderingUntilAddOnSetsAreSelectable,
  customerAddOnSetsForItem,
} from "@/lib/customer-add-on-sets";
import {
  computeUpgradeBuyableTotal,
  deriveUpgradePrices,
} from "@/lib/upgrade-pricing";
import { isDealLimitSoldOut } from "@/lib/deal-selling-limits";
import { withObservability } from "@/lib/observability/route-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeImageFit(value: string | null | undefined): ImageFit {
  return value === "CONTAIN" ? "CONTAIN" : "COVER";
}

function nextDealScheduleRefreshAt(
  deals: Array<{ dealStartsAt: Date | null; dealExpiresAt: Date | null }>,
  now: Date
): string | null {
  const nowMs = now.getTime();
  let nextMs: number | null = null;

  for (const deal of deals) {
    const startsAtMs = deal.dealStartsAt?.getTime() ?? null;
    const expiresAtMs = deal.dealExpiresAt?.getTime() ?? null;

    if (startsAtMs != null && startsAtMs > nowMs) {
      nextMs = nextMs == null ? startsAtMs : Math.min(nextMs, startsAtMs);
    }
    if (expiresAtMs != null && expiresAtMs > nowMs) {
      nextMs = nextMs == null ? expiresAtMs : Math.min(nextMs, expiresAtMs);
    }
  }

  return nextMs == null ? null : new Date(nextMs).toISOString();
}

export async function GET(req: NextRequest) {
  return withObservability(req, async (req, _obsCtx) => {
  const isAdmin =
    (await hasValidAdminAuth(req)) || Boolean(await getAdminSessionFromRequest(req));
  const deviceActor = isAdmin ? null : await getDeviceSessionFromRequest(req);

  if (!isAdmin && (!deviceActor || deviceActor.role !== "kiosk")) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 }
    );
  }

  const outletId = deviceActor ? getDeviceMenuOutletId(deviceActor) : DEFAULT_OUTLET_ID;
  if (!outletId) {
    return NextResponse.json(
      { error: "Unauthorized", errorCode: "unauthorized" },
      { status: 401 }
    );
  }
  const now = new Date();
  const strictDealBaseEnforcement = isStrictDealBaseEnforcementEnabled();
  const [version, categories, items, dealScheduleBoundaries] = await Promise.all([
    getOutletMenuVersion(prisma, outletId),
    prisma.category.findMany({
      where: { isActive: true, outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, slug: true, name: true, icon: true },
    }),
    prisma.menuItem.findMany({
      where: {
        outletId,
        isActive: true,
        OR: [
          { category: { slug: { not: "deals" } } },
          {
            AND: [
              { dealExpiresAt: { gt: now } },
              { OR: [{ dealStartsAt: null }, { dealStartsAt: { lte: now } }] },
            ],
          },
        ],
      },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        category: { select: { slug: true } },
        dealBaseMenuItem: {
          include: {
            category: { select: { slug: true } },
          },
        },
        sizes: { orderBy: { sortOrder: "asc" } },
        addons: { orderBy: { sortOrder: "asc" } },
        modifierGroupLinks: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          include: {
            modifierGroup: {
              include: {
                options: {
                  orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                },
              },
            },
            optionOverrides: { orderBy: { createdAt: "asc" } },
          },
        },
        upgradeOptions: {
          orderBy: { sortOrder: "asc" },
          include: {
            linkedItems: {
              orderBy: { sortOrder: "asc" },
              include: {
                linkedMenuItem: {
                  include: {
                    category: { select: { slug: true } },
                    sizes: { select: { id: true } },
                  },
                },
                linkedSize: true,
              },
            },
          },
        },
      },
    }),
    prisma.menuItem.findMany({
      where: {
        outletId,
        isActive: true,
        category: { slug: "deals", isActive: true },
        dealExpiresAt: { gt: now },
      },
      select: {
        dealStartsAt: true,
        dealExpiresAt: true,
      },
    }),
  ]);

  return NextResponse.json(
    {
      outletId: version.outletId,
      revision: version.revision,
      updatedAt: version.updatedAt,
      scheduleRefreshAt: nextDealScheduleRefreshAt(dealScheduleBoundaries, now),
      categories,
      items: items.flatMap((i) => {
        const isDealItem = i.category.slug === "deals";
        if (isDealItem) {
          const schedule = validateDealSchedule(
            { startsAt: i.dealStartsAt, expiresAt: i.dealExpiresAt },
            now,
          );
          if (!schedule.ok || schedule.status !== "active") return [];
        }
        if (
          isDealItem &&
          strictDealBaseEnforcement &&
          !isDealCustomerVisible(i, now).visible
        ) {
          return [];
        }

        const hydratedUpgrades: UpgradeOptionDTO[] = isDealItem
          ? i.upgradeOptions
              .map((option) => ({
                option,
                linkedItems: strictDealBaseEnforcement
                  ? getCompleteDealUpgradeLinks(i, option)
                  : getRenderableUpgradeLinks(option),
              }))
              .filter(({ linkedItems }) => linkedItems.length > 0)
              .map(({ option, linkedItems }) => {
                // Live recompute path: when the operator configured a discount %, the
                // dollar amounts are derived from the items the customer can actually
                // buy at this moment. Stock toggles, linked-item price changes, and
                // size swaps all flow through automatically. Manual mode (discountPct
                // null) keeps the saved extraCharge / savingsLabel as-is.
                const live = (() => {
                  if (option.discountPct == null) {
                    return {
                      extraCharge: Number(option.extraCharge),
                      savingsLabel:
                        option.savingsLabel != null
                          ? Number(option.savingsLabel)
                          : null,
                    };
                  }
                  const buyableTotal = computeUpgradeBuyableTotal(
                    linkedItems.map((link) => ({
                      basePrice: Number(link.linkedMenuItem!.price),
                      sizeDelta: link.linkedSize?.priceDelta != null
                        ? Number(link.linkedSize.priceDelta)
                        : 0,
                    }))
                  );
                  return deriveUpgradePrices(buyableTotal, Number(option.discountPct));
                })();
                return {
                  id: option.id,
                  customTitle: option.customTitle,
                  extraCharge: live.extraCharge,
                  savingsLabel: live.savingsLabel,
                  linkedItems: linkedItems.map((link): UpgradeLinkedItemDTO => {
                    // The selected visibility helper already verified linkedMenuItem is
                    // non-null, active, and in stock; the non-null assertion below is
                    // safe by construction.
                    const menuItem = link.linkedMenuItem!;
                    const sizeDelta = link.linkedSize?.priceDelta;
                    return {
                      id: link.id,
                      menuItemId: link.linkedMenuItemId,
                      sizeId: link.linkedSizeId,
                      nameSnapshot: menuItem.name,
                      sizeName: link.linkedSize?.name ?? null,
                      price:
                        Number(menuItem.price) +
                        (sizeDelta != null ? Number(sizeDelta) : 0),
                      emoji: menuItem.emoji,
                      bgColor: menuItem.bgColor,
                    };
                  }),
                };
              })
          : [];

        if (isDealItem && hydratedUpgrades.length === 0) {
          return [];
        }

        const addOnSets = isDealItem ? [] : customerAddOnSetsForItem(i);
        const requiredAddOnSelectionBlocked =
          !isDealItem && blocksCustomerOrderingUntilAddOnSetsAreSelectable(addOnSets);
        const dealLimitSoldOut = isDealItem ? isDealLimitSoldOut(i) : false;

        return {
          id: i.id,
          categoryId: i.categoryId,
          comboNum: i.comboNum,
          name: i.name,
          description: i.description,
          price: Number(i.price),
          emoji: i.emoji,
          bgColor: i.bgColor,
          badge: i.badge,
          // Transition: prefer bundleSavings; fall back to legacy mealSavings while
          // both columns are alive (Migration 3 drops mealSavings later).
          bundleSavings:
            i.bundleSavings != null
              ? Number(i.bundleSavings)
              : i.mealSavings != null
              ? Number(i.mealSavings)
              : null,
          imageUrl: i.imageUrl,
          imageAlt: i.imageAlt,
          imageFit: normalizeImageFit(i.imageFit),
          cardImageUrl: i.cardImageUrl,
          cardImageAlt: i.cardImageAlt,
          stockMode: i.stockMode,
          stockQty: i.stockQty,
          lowStockThreshold: i.lowStockThreshold,
          dealLimitMode: isDealItem ? i.dealLimitMode : undefined,
          dealLimitQty: isDealItem ? i.dealLimitQty : undefined,
          dealLimitLowThreshold: isDealItem ? i.dealLimitLowThreshold : undefined,
          dealLimitSoldOut: isDealItem ? dealLimitSoldOut : undefined,
          // Deals use hidden/live visibility based on schedule and available included
          // items, but limited deals at 0 remain visible as sold out.
          isOutOfStock: isDealItem
            ? dealLimitSoldOut
            : !isMenuItemAvailable(i) || requiredAddOnSelectionBlocked,
          sizes: i.sizes.map((s) => ({ id: s.id, name: s.name, priceDelta: Number(s.priceDelta) })),
          addons: i.addons.map((a) => ({ id: a.id, name: a.name, priceDelta: Number(a.priceDelta) })),
          addOnSets,
          upgradeOptions: hydratedUpgrades,
        };
      }),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
  });
}
