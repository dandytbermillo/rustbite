import { round2 } from "./pricing";

/**
 * Sum the prices of buyable upgrade links — the caller is responsible for
 * passing only links that should contribute (i.e. already filtered by
 * isUpgradeRenderable / classifyLink === "ok").
 *
 * `priceItems` is a generic shape so this helper works for both Prisma
 * records (where prices arrive as Decimal) and the kiosk DTO (where they
 * arrive as numbers): the caller normalizes to numbers before calling.
 */
export function computeUpgradeBuyableTotal(
  priceItems: ReadonlyArray<{ basePrice: number; sizeDelta: number }>
): number {
  return round2(
    priceItems.reduce((sum, p) => sum + p.basePrice + p.sizeDelta, 0)
  );
}

/**
 * Given a buyable items total and a discount %, derive the dollar amounts the
 * customer sees: customer pays `extraCharge`, with `savingsLabel` shown as
 * "Save $X" on the upgrade card.
 *
 * Rounding rule: compute savings first, then extraCharge as the remainder, so
 * the two always sum back to `buyableTotal` exactly (no 1¢ drift).
 *
 * Returns null savingsLabel when the savings round to $0.00 — the kiosk hides
 * the "Save $X" label in that case.
 */
export function deriveUpgradePrices(
  buyableTotal: number,
  discountPct: number
): { extraCharge: number; savingsLabel: number | null } {
  const clamped = Math.max(0, Math.min(100, discountPct));
  if (buyableTotal <= 0) {
    return { extraCharge: 0, savingsLabel: null };
  }
  const savings = round2((buyableTotal * clamped) / 100);
  const extraCharge = round2(buyableTotal - savings);
  return {
    extraCharge,
    savingsLabel: savings > 0 ? savings : null,
  };
}
