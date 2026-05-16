export type MenuStockMode = "MANUAL" | "QUANTITY";

export type MenuAvailabilityInput = {
  isActive: boolean;
  isOutOfStock?: boolean | null;
  stockMode?: MenuStockMode | null;
  stockQty?: number | null;
};

export function isQuantityTracked(
  item: Pick<MenuAvailabilityInput, "stockMode">
): boolean {
  return item.stockMode === "QUANTITY";
}

export function isMenuItemAvailable(item: MenuAvailabilityInput): boolean {
  if (!item.isActive) return false;
  if (item.isOutOfStock) return false;

  if (isQuantityTracked(item)) {
    return (item.stockQty ?? 0) > 0;
  }

  return true;
}
