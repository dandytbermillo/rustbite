import type { CartItemState, UpgradeSnapshot } from "./types";

function selectedUpgradeSummary(snapshot: UpgradeSnapshot): string {
  const customTitle = snapshot.customTitle?.trim();
  const firstLinkedItem = snapshot.linkedItems[0]?.nameSnapshot.trim();
  const title = customTitle || (firstLinkedItem ? `ADD ${firstLinkedItem.toUpperCase()}` : snapshot.titleSnapshot);
  const includedCount = customTitle ? snapshot.linkedItems.length : Math.max(0, snapshot.linkedItems.length - 1);

  if (includedCount <= 0) {
    return title;
  }

  return `${title} · +${includedCount} included ${includedCount === 1 ? "item" : "items"}`;
}

export function cartLineSummaryParts(line: CartItemState): string[] {
  const parts: string[] = [];

  if (line.size) {
    parts.push(line.size.name);
  }

  if (line.selectedUpgradeSnapshot) {
    parts.push(selectedUpgradeSummary(line.selectedUpgradeSnapshot));
  }

  if (line.addons.length > 0) {
    parts.push(`+${line.addons.length} ${line.addons.length === 1 ? "extra" : "extras"}`);
  }

  const addOnSetOptionCount = line.addOnSetSelections.reduce(
    (count, set) => count + set.options.length,
    0
  );
  if (addOnSetOptionCount > 0) {
    parts.push(
      `+${addOnSetOptionCount} ${addOnSetOptionCount === 1 ? "add-on" : "add-ons"}`
    );
  }

  return parts;
}
