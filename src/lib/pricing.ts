import type { CartItemState } from "./types";

export const GST_RATE = Number(process.env.GST_RATE ?? "0.05");

export function computeLineTotal(ci: CartItemState): number {
  const size = ci.size?.price ?? 0;
  const addons = ci.addons.reduce((s, a) => s + a.price, 0);
  const addOnSets = ci.addOnSetSelections.reduce(
    (sum, set) =>
      sum + set.options.reduce((optionSum, option) => optionSum + option.price, 0),
    0
  );
  const upgrade = ci.selectedUpgradeSnapshot?.extraCharge ?? 0;
  return (ci.item.price + size + addons + addOnSets + upgrade) * ci.qty;
}

export function fmt(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
