import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { GST_RATE, round2 } from "./pricing";
import { STORE_CONFIG } from "./store-config";
import type {
  AddOnSetDTO,
  AddOnSetOptionDTO,
  CheckoutLineSnapshot,
  CheckoutRequestInput,
  CheckoutSnapshot,
  PaymentMethod,
  PaymentSessionErrorCode,
  StockUnavailableResponseItem,
  StockRequirementSnapshot,
  UpgradeSnapshot,
} from "./types";
import { effectiveTitle } from "./auto-title";
import {
  getCompleteDealUpgradeLinks,
  isDealCustomerVisible,
  isStrictDealBaseEnforcementEnabled,
} from "./deal-base-validation";
import { validateDealSchedule } from "./deal-schedule";
import { getRenderableUpgradeLinks } from "./upgrade-renderability";
import {
  computeUpgradeBuyableTotal,
  deriveUpgradePrices,
} from "./upgrade-pricing";
import { isMenuItemAvailable } from "./menu-availability";
import { customerAddOnSetsForItem } from "./customer-add-on-sets";
import { isDealLimitSoldOut } from "./deal-selling-limits";

export class CheckoutContractError extends Error {
  constructor(
    public readonly code: PaymentSessionErrorCode,
    message: string,
    public readonly items?: StockUnavailableResponseItem[]
  ) {
    super(message);
    this.name = "CheckoutContractError";
  }
}

export function validateCheckoutRequest(body: unknown): CheckoutRequestInput {
  if (!body || typeof body !== "object") throw new Error("Invalid body");
  const b = body as Partial<CheckoutRequestInput>;

  if (b.orderType !== "DINE_IN" && b.orderType !== "TAKEOUT") {
    throw new Error("Invalid orderType");
  }

  if (
    b.paymentMethod !== "CARD" &&
    b.paymentMethod !== "MOBILE" &&
    b.paymentMethod !== "CASH"
  ) {
    throw new Error("Invalid paymentMethod");
  }

  if (
    typeof b.expectedTotal !== "number" ||
    !Number.isFinite(b.expectedTotal) ||
    b.expectedTotal < 0
  ) {
    throw new Error("Invalid expectedTotal");
  }

  if (!Array.isArray(b.items) || b.items.length === 0) {
    throw new Error("Cart is empty");
  }

  for (const item of b.items) {
    if (typeof item.menuItemId !== "string" || !item.menuItemId) {
      throw new Error("Invalid menuItemId");
    }
    if (typeof item.qty !== "number" || item.qty < 1) {
      throw new Error("Invalid qty");
    }
    if (
      item.selectedUpgradeOptionId != null &&
      typeof item.selectedUpgradeOptionId !== "string"
    ) {
      throw new Error("Invalid selectedUpgradeOptionId");
    }
    if (item.addOnSetSelections != null) {
      if (!Array.isArray(item.addOnSetSelections)) {
        throw new Error("Invalid addOnSetSelections");
      }
      for (const selection of item.addOnSetSelections) {
        if (
          !selection ||
          typeof selection !== "object" ||
          typeof selection.itemLinkId !== "string" ||
          !Array.isArray(selection.optionIds) ||
          selection.optionIds.some((optionId) => typeof optionId !== "string")
        ) {
          throw new Error("Invalid addOnSetSelections");
        }
      }
    }
  }

  return b as CheckoutRequestInput;
}

type ResolvedAddOnSetSelection = {
  itemLinkId: string;
  groupId: string;
  name: string;
  options: Array<{
    id: string;
    name: string;
    priceDelta: number;
    stockMode: "MANUAL" | "QUANTITY";
    stockQty: number | null;
  }>;
};

function selectionCountIsValid(set: AddOnSetDTO, count: number): boolean {
  if (count < set.minSelect) return false;
  if (set.maxSelect != null && count > set.maxSelect) return false;
  return true;
}

function selectedAddOnSetOption(
  option: AddOnSetOptionDTO | undefined
): AddOnSetOptionDTO {
  if (!option) {
    throw new CheckoutContractError(
      "MENU_MODIFIER_INVALID",
      "A size or add-on in your cart changed. Review your order before paying."
    );
  }
  if (!option.isAvailable) {
    throw new CheckoutContractError(
      option.unavailableReason === "OUT_OF_STOCK"
        ? "MENU_STOCK_UNAVAILABLE"
        : "MENU_MODIFIER_INVALID",
      "A size or add-on in your cart changed. Review your order before paying."
    );
  }
  return option;
}

export async function buildCheckoutSnapshot(
  body: CheckoutRequestInput,
  outletId: string
): Promise<CheckoutSnapshot> {
  const now = new Date();
  const strictDealBaseEnforcement = isStrictDealBaseEnforcementEnabled();
  const menuItemIds = Array.from(new Set(body.items.map((item) => item.menuItemId)));
  const menuItems = await prisma.menuItem.findMany({
    where: {
      id: { in: menuItemIds },
      outletId,
      isActive: true,
      AND: [
        { OR: [{ isOutOfStock: false }, { category: { slug: "deals" } }] },
        {
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
      ],
    },
    include: {
      category: { select: { slug: true } },
      dealBaseMenuItem: {
        include: {
          category: { select: { slug: true } },
        },
      },
      sizes: true,
      addons: true,
      modifierGroupLinks: {
        include: {
          modifierGroup: {
            include: {
              options: true,
            },
          },
          optionOverrides: true,
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
  });
  const itemMap = new Map(menuItems.map((item) => [item.id, item]));

  let subtotal = 0;
  const snapshotItems: CheckoutLineSnapshot[] = [];
  const stockRequirements: StockRequirementSnapshot[] = [];

  for (const item of body.items) {
    const menuItem = itemMap.get(item.menuItemId);
    if (!menuItem) {
      throw new CheckoutContractError(
        "MENU_ITEM_UNAVAILABLE",
        "An item in your cart is no longer available. Review your order before paying."
      );
    }
    const isDealLine = menuItem.category.slug === "deals";

    if (isDealLine) {
      const schedule = validateDealSchedule(
        { startsAt: menuItem.dealStartsAt, expiresAt: menuItem.dealExpiresAt },
        now,
      );
      if (!schedule.ok || schedule.status !== "active") {
        throw new CheckoutContractError(
          "MENU_ITEM_UNAVAILABLE",
          "An item in your cart is no longer available. Review your order before paying."
        );
      }
      const dealLimitQty = menuItem.dealLimitQty ?? 0;
      if (
        isDealLimitSoldOut(menuItem) ||
        (menuItem.dealLimitMode === "LIMITED" && dealLimitQty < item.qty)
      ) {
        throw new CheckoutContractError(
          "MENU_STOCK_UNAVAILABLE",
          "This deal is sold out. Review your order before paying.",
          [
            {
              targetType: "DEAL_LIMIT",
              targetId: menuItem.id,
              targetNameSnapshot: menuItem.name,
              requestedQty: item.qty,
              availableQty: dealLimitQty,
              menuItemId: menuItem.id,
              nameSnapshot: menuItem.name,
            },
          ]
        );
      }
    }

    if (!isDealLine && !isMenuItemAvailable(menuItem)) {
      throw new CheckoutContractError(
        "MENU_ITEM_UNAVAILABLE",
        "An item in your cart is no longer available. Review your order before paying."
      );
    }

    if (!isDealLine && menuItem.stockMode === "QUANTITY") {
      stockRequirements.push({
        targetType: "MENU_ITEM",
        targetId: menuItem.id,
        targetNameSnapshot: menuItem.name,
        menuItemId: menuItem.id,
        qty: item.qty,
        source: "NORMAL_ITEM",
        orderLineMenuItemId: menuItem.id,
      });
    }

    let size: null | { id: string; name: string; priceDelta: number } = null;
    if (item.sizeId) {
      const matched = menuItem.sizes.find((candidate) => candidate.id === item.sizeId);
      if (!matched) {
        throw new CheckoutContractError(
          "MENU_MODIFIER_INVALID",
          "A size or add-on in your cart changed. Review your order before paying."
        );
      }
      size = {
        id: matched.id,
        name: matched.name,
        priceDelta: Number(matched.priceDelta),
      };
    }

    const addons = (item.addonIds ?? [])
      .map((addonId) => menuItem.addons.find((addon) => addon.id === addonId))
      .filter((addon): addon is (typeof menuItem.addons)[number] => !!addon);

    if ((item.addonIds ?? []).length !== addons.length) {
      throw new CheckoutContractError(
        "MENU_MODIFIER_INVALID",
        "A size or add-on in your cart changed. Review your order before paying."
      );
    }

    const requestedAddOnSetSelections = item.addOnSetSelections ?? [];
    if (isDealLine && requestedAddOnSetSelections.length > 0) {
      throw new CheckoutContractError(
        "MENU_MODIFIER_INVALID",
        "A size or add-on in your cart changed. Review your order before paying."
      );
    }

    const addOnSets = isDealLine ? [] : customerAddOnSetsForItem(menuItem);
    const requestedByLink = new Map<string, string[]>();
    for (const selection of requestedAddOnSetSelections) {
      if (requestedByLink.has(selection.itemLinkId)) {
        throw new CheckoutContractError(
          "MENU_MODIFIER_INVALID",
          "A size or add-on in your cart changed. Review your order before paying."
        );
      }
      requestedByLink.set(selection.itemLinkId, selection.optionIds);
    }

    for (const requestedLinkId of requestedByLink.keys()) {
      if (!addOnSets.some((set) => set.itemLinkId === requestedLinkId)) {
        throw new CheckoutContractError(
          "MENU_MODIFIER_INVALID",
          "A size or add-on in your cart changed. Review your order before paying."
        );
      }
    }

    const addOnSetSelections: ResolvedAddOnSetSelection[] = [];
    for (const set of addOnSets) {
      const optionIds = requestedByLink.get(set.itemLinkId) ?? [];
      if (
        new Set(optionIds).size !== optionIds.length ||
        !selectionCountIsValid(set, optionIds.length)
      ) {
        throw new CheckoutContractError(
          "MENU_MODIFIER_INVALID",
          "A size or add-on in your cart changed. Review your order before paying."
        );
      }

      if (optionIds.length === 0) continue;

      const link = menuItem.modifierGroupLinks.find(
        (candidate) => candidate.id === set.itemLinkId
      );
      const selectedOptions = optionIds.map((optionId) => {
        const dtoOption = selectedAddOnSetOption(
          set.options.find((candidate) => candidate.id === optionId)
        );
        const optionRow = link?.modifierGroup.options.find(
          (candidate) => candidate.id === dtoOption.id
        );
        if (!optionRow) {
          throw new CheckoutContractError(
            "MENU_MODIFIER_INVALID",
            "A size or add-on in your cart changed. Review your order before paying."
          );
        }
        return {
          id: dtoOption.id,
          name: dtoOption.name,
          priceDelta: dtoOption.priceDelta,
          stockMode: optionRow.stockMode,
          stockQty: optionRow.stockQty,
        };
      });

      addOnSetSelections.push({
        itemLinkId: set.itemLinkId,
        groupId: set.groupId,
        name: set.name,
        options: selectedOptions,
      });

      for (const option of selectedOptions) {
        if (option.stockMode !== "QUANTITY") continue;
        stockRequirements.push({
          targetType: "SHARED_MODIFIER_OPTION",
          targetId: option.id,
          targetNameSnapshot: option.name,
          sharedModifierOptionId: option.id,
          qty: item.qty,
          source: "SHARED_MODIFIER_OPTION",
          orderLineMenuItemId: menuItem.id,
        });
      }
    }

    if (
      strictDealBaseEnforcement &&
      isDealLine &&
      !item.selectedUpgradeOptionId
    ) {
      throw new CheckoutContractError(
        "MENU_MODIFIER_INVALID",
        "A deal in your cart changed. Review your order before paying."
      );
    }

    // Resolve upgrade option scoped through the parent menu item only — never
    // via a global lookup. A request that points at one item's id but supplies
    // another item's selectedUpgradeOptionId fails with MENU_MODIFIER_INVALID.
    let upgradeSnapshot: UpgradeSnapshot | null = null;
    let upgradeExtraCharge = 0;
    if (item.selectedUpgradeOptionId) {
      if (!isDealLine) {
        throw new CheckoutContractError(
          "MENU_MODIFIER_INVALID",
          "A size or add-on in your cart changed. Review your order before paying."
        );
      }
      if (
        strictDealBaseEnforcement &&
        !isDealCustomerVisible(menuItem, now).visible
      ) {
        throw new CheckoutContractError(
          "MENU_ITEM_UNAVAILABLE",
          "A deal in your cart is no longer available. Review your order before paying."
        );
      }
      if (
        menuItem.dealBaseMenuItemId &&
        menuItem.dealBaseMenuItem &&
        menuItem.dealBaseMenuItem.outletId === outletId &&
        menuItem.dealBaseMenuItem.category.slug !== "deals"
      ) {
        if (!isMenuItemAvailable(menuItem.dealBaseMenuItem)) {
          throw new CheckoutContractError(
            "MENU_ITEM_UNAVAILABLE",
            "A deal in your cart is no longer available. Review your order before paying."
          );
        }
        if (menuItem.dealBaseMenuItem.stockMode === "QUANTITY") {
          stockRequirements.push({
            targetType: "MENU_ITEM",
            targetId: menuItem.dealBaseMenuItem.id,
            targetNameSnapshot: menuItem.dealBaseMenuItem.name,
            menuItemId: menuItem.dealBaseMenuItem.id,
            qty: item.qty,
            source: "DEAL_BASE_ITEM",
            orderLineMenuItemId: menuItem.id,
            upgradeOptionId: item.selectedUpgradeOptionId,
          });
        }
      }
      const option = menuItem.upgradeOptions.find(
        (u) => u.id === item.selectedUpgradeOptionId
      );
      if (!option) {
        throw new CheckoutContractError(
          "MENU_MODIFIER_INVALID",
          "A size or add-on in your cart changed. Review your order before paying."
        );
      }
      // Apply the same renderability filter as kiosk hydration; reject hidden
      // or broken upgrades to close stale-cart and crafted-request paths. The
      // snapshot only includes currently available linked items.
      const renderableLinkedItems = strictDealBaseEnforcement
        ? getCompleteDealUpgradeLinks(menuItem, option)
        : getRenderableUpgradeLinks(option);
      if (renderableLinkedItems.length === 0) {
        throw new CheckoutContractError(
          "MENU_MODIFIER_INVALID",
          "A size or add-on in your cart changed. Review your order before paying."
        );
      }
      for (const link of renderableLinkedItems) {
        const linkedMenuItem = link.linkedMenuItem!;
        if (linkedMenuItem.stockMode !== "QUANTITY") continue;
        stockRequirements.push({
          targetType: "MENU_ITEM",
          targetId: linkedMenuItem.id,
          targetNameSnapshot: linkedMenuItem.name,
          menuItemId: linkedMenuItem.id,
          qty: item.qty,
          source: "DEAL_INCLUDED_ITEM",
          orderLineMenuItemId: menuItem.id,
          upgradeOptionId: option.id,
          upgradeItemLinkId: link.id,
        });
      }
      // Live recompute mirrors api/menu/route.ts: when discountPct is set, the
      // dollar amounts come from the items the customer can actually buy at
      // checkout time, not from the saved columns. This ensures the customer
      // is charged exactly what was just shown to them and absorbs any stock /
      // price drift that happened between page-load and pay. The frozen
      // upgradeSnapshotJson captures the live-computed amounts.
      let liveExtraCharge: number;
      let liveSavingsLabel: number | null;
      if (option.discountPct == null) {
        liveExtraCharge = Number(option.extraCharge);
        liveSavingsLabel =
          option.savingsLabel != null ? Number(option.savingsLabel) : null;
      } else {
        const buyableTotal = computeUpgradeBuyableTotal(
          renderableLinkedItems.map((link) => ({
            basePrice: Number(link.linkedMenuItem!.price),
            sizeDelta: link.linkedSize?.priceDelta != null
              ? Number(link.linkedSize.priceDelta)
              : 0,
          }))
        );
        const derived = deriveUpgradePrices(
          buyableTotal,
          Number(option.discountPct)
        );
        liveExtraCharge = derived.extraCharge;
        liveSavingsLabel = derived.savingsLabel;
      }
      upgradeExtraCharge = liveExtraCharge;
      upgradeSnapshot = {
        id: option.id,
        customTitle: option.customTitle,
        titleSnapshot: effectiveTitle(option, renderableLinkedItems.map((l) => ({
          nameSnapshot: l.linkedMenuItem!.name,
        }))),
        extraCharge: upgradeExtraCharge,
        savingsLabel: liveSavingsLabel,
        linkedItems: renderableLinkedItems.map((link) => {
          const linkedMenuItem = link.linkedMenuItem!;
          const sizeDelta = link.linkedSize?.priceDelta;
          return {
            id: link.id,
            menuItemId: link.linkedMenuItemId,
            sizeId: link.linkedSizeId,
            nameSnapshot: linkedMenuItem.name,
            sizeName: link.linkedSize?.name ?? null,
            price:
              Number(linkedMenuItem.price) +
              (sizeDelta != null ? Number(sizeDelta) : 0),
          };
        }),
      };
    }

    const addonSum = addons.reduce((sum, addon) => sum + Number(addon.priceDelta), 0);
    const addOnSetSum = addOnSetSelections.reduce(
      (sum, selection) =>
        sum +
        selection.options.reduce(
          (optionSum, option) => optionSum + Number(option.priceDelta),
          0
        ),
      0
    );
    const unitPrice =
      Number(menuItem.price) +
      (size?.priceDelta ?? 0) +
      addonSum +
      addOnSetSum +
      upgradeExtraCharge;
    const lineTotal = round2(unitPrice * item.qty);
    subtotal += lineTotal;

    snapshotItems.push({
      lineKind: isDealLine ? "DEAL" : "ITEM",
      menuItemId: menuItem.id,
      nameSnapshot: menuItem.name,
      qty: item.qty,
      sizeId: size?.id ?? null,
      sizeName: size?.name ?? null,
      sizePriceDelta: size?.priceDelta ?? null,
      addonIds: addons.map((addon) => addon.id),
      addons: addons
        .map((addon) => ({
          name: addon.name,
          priceDelta: Number(addon.priceDelta),
        }))
        .concat(
          addOnSetSelections.flatMap((selection) =>
            selection.options.map((option) => ({
              name: `${selection.name}: ${option.name}`,
              priceDelta: Number(option.priceDelta),
            }))
          )
        ),
      addOnSetSelections: addOnSetSelections.map((selection) => ({
        itemLinkId: selection.itemLinkId,
        groupId: selection.groupId,
        name: selection.name,
        options: selection.options.map((option) => ({
          id: option.id,
          name: option.name,
          priceDelta: Number(option.priceDelta),
        })),
      })),
      selectedUpgradeOptionId: upgradeSnapshot?.id ?? null,
      selectedUpgradeSnapshot: upgradeSnapshot,
      lineTotal,
    });
  }

  subtotal = round2(subtotal);
  const gst = round2(subtotal * GST_RATE);
  const total = round2(subtotal + gst);

  return {
    kioskId: STORE_CONFIG.kioskId,
    orderType: body.orderType,
    paymentMethod: body.paymentMethod,
    subtotal,
    gst,
    total,
    items: snapshotItems,
    stockRequirements,
  };
}

export function assertExpectedTotalMatches(
  snapshot: CheckoutSnapshot,
  expectedTotal: number
) {
  if (round2(snapshot.total) !== round2(expectedTotal)) {
    throw new CheckoutContractError(
      "MENU_TOTAL_MISMATCH",
      "Menu changed. Review your order before paying."
    );
  }
}

export function buildOrderItemCreates(
  snapshot: CheckoutSnapshot
): Prisma.OrderItemUncheckedCreateWithoutOrderInput[] {
  return snapshot.items.map((item) => ({
    menuItemId: item.menuItemId,
    nameSnapshot: item.nameSnapshot,
    qty: item.qty,
    sizeName: item.sizeName,
    sizePriceDelta:
      item.sizePriceDelta != null
        ? new Prisma.Decimal(item.sizePriceDelta)
        : null,
    addonsJson: item.addons,
    addOnSetSelectionsJson:
      item.addOnSetSelections as unknown as Prisma.InputJsonValue,
    // Legacy isMeal column stays for historical reads. New orders write false
    // and embed the upgrade in upgradeSnapshotJson per the deprecation plan.
    isMeal: false,
    mealUpgrade: null,
    upgradeSnapshotJson: item.selectedUpgradeSnapshot
      ? (item.selectedUpgradeSnapshot as unknown as Prisma.InputJsonValue)
      : Prisma.JsonNull,
    lineTotal: new Prisma.Decimal(item.lineTotal),
  }));
}

export function isCounterPaymentMethod(method: PaymentMethod): boolean {
  return method === "CASH";
}
