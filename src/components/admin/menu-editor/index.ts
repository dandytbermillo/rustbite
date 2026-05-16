// Public surface for the menu-editor component family.
// Wiring step replaces the relevant blocks inside MenuEditor.tsx with
// these components; until then they're additive and not imported anywhere.

export { default as EditItemModal } from "./EditItemModal";
export { default as EditDealModal } from "./EditDealModal";
export { default as ModalShell } from "./ModalShell";
export { default as KioskItemPreview } from "./KioskItemPreview";
export { default as KioskDealPreview } from "./KioskDealPreview";
export { default as SizesEditor } from "./SizesEditor";
export { default as AddonsEditor } from "./AddonsEditor";
export { default as UpgradeOptionEditor } from "./UpgradeOptionEditor";
export { default as HeroImageUpload } from "./HeroImageUpload";
export { default as VisibilityRow } from "./VisibilityRow";
export { default as StatusPill, MetaChip } from "./StatusPill";
export { default as LinkedItemPicker } from "./LinkedItemPicker";
export type { PickerItem } from "./LinkedItemPicker";

export type {
  Item,
  Category,
  HeroPending,
  ModalMode,
  SaveResult,
  SharedModifierGroup,
  SharedModifierItemMutationResult,
  SharedModifierOption,
  SharedModifierSelectionMode,
  SharedModifierWorkspaceControls,
  WorkspaceAddOnManagerFocus,
  ItemModifierGroupLink,
  ItemModifierOptionOverride,
  ModifierContractMode,
  EditModalSharedProps,
  AdminModifierInput,
  AdminUpgradeOptionInput,
  AdminUpgradeItemLinkInput,
} from "./types";
