import type { MenuItemDTO } from "@/lib/types";

type KioskStockLabelInput = Pick<
  MenuItemDTO,
  "isOutOfStock" | "stockMode" | "stockQty" | "lowStockThreshold"
>;

export function shouldShowKioskLowStockLabel(
  item: KioskStockLabelInput
): boolean {
  if (item.isOutOfStock || item.stockMode !== "QUANTITY") return false;
  if (item.lowStockThreshold == null) return false;

  const stockQty = item.stockQty ?? 0;
  return stockQty > 0 && stockQty <= item.lowStockThreshold;
}

export function getKioskLowStockLabel(
  item: KioskStockLabelInput
): string | null {
  return shouldShowKioskLowStockLabel(item) ? "Limited" : null;
}

export function getKioskLowStockMessage(
  item: KioskStockLabelInput
): string | null {
  return shouldShowKioskLowStockLabel(item) ? "Only a few left." : null;
}
