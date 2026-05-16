import { effectiveTitle } from "./auto-title";
import type { UpgradeOptionDTO, UpgradeSnapshot } from "./types";

export function snapshotFromUpgradeOption(option: UpgradeOptionDTO): UpgradeSnapshot {
  return {
    id: option.id,
    customTitle: option.customTitle,
    titleSnapshot: effectiveTitle(option, option.linkedItems),
    extraCharge: option.extraCharge,
    savingsLabel: option.savingsLabel,
    linkedItems: option.linkedItems.map((li) => ({
      id: li.id,
      menuItemId: li.menuItemId,
      sizeId: li.sizeId,
      nameSnapshot: li.nameSnapshot,
      sizeName: li.sizeName,
      price: li.price,
    })),
  };
}
