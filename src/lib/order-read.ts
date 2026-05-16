// Shared helper for order-read surfaces (kitchen, counter, admin orders) to
// turn an OrderItem's upgradeSnapshotJson + legacy isMeal into a single
// display string. Server-frozen titleSnapshot wins when present; otherwise we
// fall back to today's bare "MEAL" chip — historical orders only carry
// isMeal + addonsJson on the shared response shape (no mealUpgrade exposed).

export function getUpgradeTitle(upgradeSnapshotJson: unknown): string | null {
  if (!upgradeSnapshotJson || typeof upgradeSnapshotJson !== "object") return null;
  const obj = upgradeSnapshotJson as { titleSnapshot?: unknown };
  if (typeof obj.titleSnapshot === "string" && obj.titleSnapshot.length > 0) {
    return obj.titleSnapshot;
  }
  return null;
}

export function formatUpgradeForOrderRead(item: {
  isMeal: boolean;
  upgradeSnapshotJson?: unknown;
}): string | null {
  const title = getUpgradeTitle(item.upgradeSnapshotJson);
  if (title) return title;
  if (item.isMeal) return "MEAL";
  return null;
}
