import { GST_RATE, computeLineTotal, round2 } from "@/lib/pricing";
import type {
  AddOnSetCartSelection,
  CartItemState,
  AddOnSetDTO,
  AddOnSetOptionDTO,
  MenuItemDTO,
  Modifier,
  ModifierOption,
  PaymentSessionErrorCode,
  StockUnavailableResponseItem,
} from "@/lib/types";

export const MENU_REVIEW_MESSAGE = "Menu changed. Review your order before paying.";

export type KioskMenuForReconcile = {
  items: MenuItemDTO[];
};

export type CartReconcileResult =
  | { ok: true; cart: CartItemState[]; total: number }
  | { ok: false; message: string };

export type CustomizeReconcileResult =
  | { ok: true; line: CartItemState; totalChanged: boolean }
  | { ok: false; message: string };

const optToMod = (o: ModifierOption | undefined): Modifier | null =>
  o ? { id: o.id, name: o.name, price: o.priceDelta } : null;

function selectedAddOnSetOptionToMod(
  option: AddOnSetOptionDTO | undefined
): Modifier | null {
  if (!option || !option.isAvailable) return null;
  return { id: option.id, name: option.name, price: option.priceDelta };
}

function selectionCountIsValid(set: AddOnSetDTO, count: number): boolean {
  if (count < set.minSelect) return false;
  if (set.maxSelect != null && count > set.maxSelect) return false;
  return true;
}

function reconcileAddOnSetSelections(
  line: CartItemState,
  item: MenuItemDTO
): AddOnSetCartSelection[] | null {
  const requestedByLink = new Map(
    line.addOnSetSelections.map((selection) => [
      selection.itemLinkId,
      selection,
    ])
  );
  const rebuilt: AddOnSetCartSelection[] = [];

  for (const selection of line.addOnSetSelections) {
    if (!item.addOnSets.some((set) => set.itemLinkId === selection.itemLinkId)) {
      return null;
    }
  }

  for (const set of item.addOnSets) {
    const requested = requestedByLink.get(set.itemLinkId);
    const optionIds = requested?.options.map((option) => option.id) ?? [];
    if (new Set(optionIds).size !== optionIds.length) return null;
    if (!selectionCountIsValid(set, optionIds.length)) return null;

    const options = optionIds.map((optionId) =>
      selectedAddOnSetOptionToMod(
        set.options.find((candidate) => candidate.id === optionId)
      )
    );
    if (options.some((option) => option == null)) return null;

    if (options.length > 0) {
      rebuilt.push({
        itemLinkId: set.itemLinkId,
        groupId: set.groupId,
        name: set.name,
        options: options as Modifier[],
      });
    }
  }

  return rebuilt;
}

export function formatQuantityLimitMessage(
  name: string,
  requestedQty: number,
  availableQty: number
): string {
  if (availableQty <= 0) {
    return `${name} is now out of stock. Remove it before paying.`;
  }

  return `Only ${availableQty} left for ${name}. Lower the quantity from ${requestedQty} before paying.`;
}

export function maxOrderableQuantityForItem(item: MenuItemDTO): number | null {
  if (item.dealLimitMode === "LIMITED") {
    return Math.max(0, item.dealLimitQty ?? 0);
  }

  if (item.stockMode === "QUANTITY") {
    return Math.max(0, item.stockQty ?? 0);
  }

  return null;
}

export function formatStockUnavailableNotice(
  items: readonly StockUnavailableResponseItem[] | undefined
): string {
  if (!items || items.length === 0) {
    return "Some items do not have enough stock. Review your order before paying.";
  }

  if (items.length === 1) {
    const item = items[0];
    return formatQuantityLimitMessage(
      stockUnavailableName(item),
      item.requestedQty,
      item.availableQty
    );
  }

  const summary = items
    .map((item) =>
      item.availableQty <= 0
        ? `${stockUnavailableName(item)} is out of stock`
        : `${stockUnavailableName(item)}: ${item.availableQty} left, ${item.requestedQty} in cart`
    )
    .join("; ");
  return `Some items do not have enough stock: ${summary}. Review your order before paying.`;
}

function stockUnavailableName(item: StockUnavailableResponseItem): string {
  return (
    item.targetNameSnapshot ??
    item.nameSnapshot ??
    "This selection"
  );
}

export function computeCartTotals(cart: CartItemState[]) {
  const subtotal = round2(cart.reduce((sum, item) => sum + computeLineTotal(item), 0));
  const gst = round2(subtotal * GST_RATE);
  const total = round2(subtotal + gst);
  return { subtotal, gst, total };
}

export function isStaleMenuErrorCode(
  code: PaymentSessionErrorCode | undefined
): code is PaymentSessionErrorCode {
  return (
    code === "MENU_ITEM_UNAVAILABLE" ||
    code === "MENU_MODIFIER_INVALID" ||
    code === "MENU_TOTAL_MISMATCH" ||
    code === "MENU_STOCK_UNAVAILABLE"
  );
}

export function rebuildCartAgainstMenu(
  cart: CartItemState[],
  nextMenu: KioskMenuForReconcile
): CartReconcileResult {
  const itemMap = new Map(nextMenu.items.map((item) => [item.id, item]));
  const quantityRequestedByItem = new Map<string, number>();
  const rebuilt: CartItemState[] = [];

  for (const line of cart) {
    const item = itemMap.get(line.item.id);
    if (!item) {
      return {
        ok: false,
        message: `${line.item.name} is no longer available. Remove it before paying.`,
      };
    }

    const maxOrderableQty = maxOrderableQuantityForItem(item);
    if (item.isOutOfStock) {
      return {
        ok: false,
        message:
          maxOrderableQty === 0
            ? formatQuantityLimitMessage(item.name, line.qty, maxOrderableQty)
            : `${item.name} is no longer available. Remove it before paying.`,
      };
    }

    const size = line.size
      ? optToMod(item.sizes.find((candidate) => candidate.id === line.size?.id))
      : null;
    if (line.size && !size) {
      return {
        ok: false,
        message: "A size or add-on in your cart changed. Review your order before paying.",
      };
    }

    const addons: Modifier[] = [];
    for (const addon of line.addons) {
      const match = item.addons.find((candidate) => candidate.id === addon.id);
      if (!match) {
        return {
          ok: false,
          message: "A size or add-on in your cart changed. Review your order before paying.",
        };
      }
      addons.push({ id: match.id, name: match.name, price: match.priceDelta });
    }

    const addOnSetSelections = reconcileAddOnSetSelections(line, item);
    if (!addOnSetSelections) {
      return {
        ok: false,
        message: "A size or add-on in your cart changed. Review your order before paying.",
      };
    }

    if (maxOrderableQty != null) {
      const requestedQty = (quantityRequestedByItem.get(item.id) ?? 0) + line.qty;
      quantityRequestedByItem.set(item.id, requestedQty);

      if (requestedQty > maxOrderableQty) {
        return {
          ok: false,
          message: formatQuantityLimitMessage(
            item.name,
            requestedQty,
            maxOrderableQty
          ),
        };
      }
    }

    // Upgrade reconciliation. Identity is by upgrade option id; if the kiosk
    // hydration filter (api/menu/route.ts -> isUpgradeRenderable) has hidden
    // the option for any reason (broken/null/inactive linked items, sticky-
    // size lost, etc.), the absence-from-DTO IS the hidden signal - force
    // review. Then drift-compare extraCharge / customTitle / ordered
    // linkedItems against the frozen snapshot. titleSnapshot is intentionally
    // excluded from drift; the customer keeps seeing the title they originally
    // picked, helper-only changes don't force review.
    if (line.selectedUpgradeOptionId != null && line.selectedUpgradeSnapshot != null) {
      const liveOption = item.upgradeOptions.find(
        (u) => u.id === line.selectedUpgradeOptionId
      );
      if (!liveOption) {
        return { ok: false, message: MENU_REVIEW_MESSAGE };
      }

      const snap = line.selectedUpgradeSnapshot;
      if (
        Number(liveOption.extraCharge) !== Number(snap.extraCharge) ||
        (liveOption.customTitle ?? null) !== (snap.customTitle ?? null) ||
        (liveOption.savingsLabel ?? null) !== (snap.savingsLabel ?? null) ||
        liveOption.linkedItems.length !== snap.linkedItems.length
      ) {
        return { ok: false, message: MENU_REVIEW_MESSAGE };
      }
      // Compare by index (canonical sortOrder ordering, preserved by both the
      // API hydration and the at-add-to-cart snapshot). Reordering the linked
      // items in the editor IS customer-visible drift - it changes the icon
      // stack order on the customize page and the auto-title order - so a
      // pure reorder must force review. Sorting by id before comparison would
      // mask exactly that.
      for (let i = 0; i < liveOption.linkedItems.length; i++) {
        const a = liveOption.linkedItems[i];
        const b = snap.linkedItems[i];
        if (
          a.menuItemId !== b.menuItemId ||
          a.sizeId !== b.sizeId ||
          a.nameSnapshot !== b.nameSnapshot ||
          (a.sizeName ?? null) !== (b.sizeName ?? null) ||
          Number(a.price) !== Number(b.price)
        ) {
          return { ok: false, message: MENU_REVIEW_MESSAGE };
        }
      }
    } else if (
      // Belt-and-suspenders: if exactly one of selectedUpgradeOptionId /
      // selectedUpgradeSnapshot is set, the cart line is malformed.
      (line.selectedUpgradeOptionId == null) !==
      (line.selectedUpgradeSnapshot == null)
    ) {
      return { ok: false, message: MENU_REVIEW_MESSAGE };
    }

    rebuilt.push({
      ...line,
      item,
      size,
      addons,
      addOnSetSelections,
    });
  }

  return {
    ok: true,
    cart: rebuilt,
    total: computeCartTotals(rebuilt).total,
  };
}

export function reconcileCustomizeDraftAgainstMenu(
  draftLine: CartItemState,
  nextMenu: KioskMenuForReconcile
): CustomizeReconcileResult {
  const rebuiltDraft = rebuildCartAgainstMenu([draftLine], nextMenu);
  if (!rebuiltDraft.ok) {
    return rebuiltDraft;
  }

  const rebuiltDraftLine = rebuiltDraft.cart[0];
  if (!rebuiltDraftLine) {
    return { ok: false, message: MENU_REVIEW_MESSAGE };
  }

  return {
    ok: true,
    line: rebuiltDraftLine,
    totalChanged:
      round2(computeLineTotal(rebuiltDraftLine)) !==
      round2(computeLineTotal(draftLine)),
  };
}
