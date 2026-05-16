// Shared types for the menu-editor component family.
// Mirrors the local `Item` type in `src/app/admin/menu/MenuEditor.tsx:90` —
// dates ride as ISO strings at the UI layer; the validator coerces them
// back to Date when persisting.

import type { ImageFit } from "@/lib/types";
import type {
  AdminModifierInput,
  AdminUpgradeOptionInput,
  AdminUpgradeItemLinkInput,
} from "@/lib/menu-admin";

export type SharedModifierSelectionMode =
  | "OPTIONAL_MULTI"
  | "REQUIRED_SINGLE"
  | "OPTIONAL_SINGLE"
  | "REQUIRED_MULTI";

export type OptionStockMode = "MANUAL" | "QUANTITY";

export type ModifierContractMode = "LEGACY" | "SHARED" | "MIXED_COMPAT";

export type SharedModifierOption = {
  id: string;
  groupId: string;
  name: string;
  priceDelta: number;
  isActive: boolean;
  stockMode?: OptionStockMode;
  isOutOfStock?: boolean;
  stockQty?: number | null;
  lowStockThreshold?: number | null;
  stockUpdatedAt?: string | null;
  stockUpdatedById?: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type SharedModifierOptionStockPatch = {
  stockMode: OptionStockMode;
  isOutOfStock: boolean;
  stockQty: number | null;
  lowStockThreshold: number | null;
};

export type SharedModifierGroup = {
  id: string;
  outletId: string;
  name: string;
  description: string | null;
  selectionMode: SharedModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
  isActive: boolean;
  sortOrder: number;
  lockVersion: number;
  createdAt: string;
  updatedAt: string;
  options: SharedModifierOption[];
  activeItemLinkCount?: number;
  totalItemLinkCount?: number;
  attachmentHistoryCount?: number;
  optionOverrideCount?: number;
  canHardDelete?: boolean;
};

export type ItemModifierOptionOverride = {
  id: string;
  menuItemModifierGroupId: string;
  modifierOptionId: string;
  isHidden: boolean;
  priceDeltaOverride: number | null;
  sortOrderOverride: number | null;
  createdAt: string;
  updatedAt: string;
  modifierOption: SharedModifierOption;
};

export type ItemModifierGroupLink = {
  id: string;
  outletId: string;
  menuItemId: string;
  modifierGroupId: string;
  sortOrder: number;
  minSelectOverride: number | null;
  maxSelectOverride: number | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  modifierGroup: SharedModifierGroup;
  optionOverrides: ItemModifierOptionOverride[];
};

export type Item = {
  id: string;
  categoryId: string;
  comboNum: number | null;
  name: string;
  description: string;
  price: number;
  emoji: string;
  bgColor: string;
  badge: string | null;
  bundleSavings: number | null;
  dealBaseMenuItemId: string | null;
  dealBaseSizeId: string | null;
  dealBaseSizeNameSnapshot: string | null;
  dealStartsAt?: string | null;
  dealExpiresAt: string | null;
  dealLimitMode?: "UNLIMITED" | "LIMITED";
  dealLimitQty?: number | null;
  dealLimitLowThreshold?: number | null;
  dealLimitUpdatedAt?: string | null;
  dealLimitUpdatedById?: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  imageFit: ImageFit;
  cardImageUrl: string | null;
  cardImageAlt: string | null;
  isActive: boolean;
  isOutOfStock: boolean;
  stockMode: "MANUAL" | "QUANTITY";
  stockQty: number | null;
  lowStockThreshold: number | null;
  stockUpdatedAt: string | null;
  stockUpdatedById: string | null;
  sortOrder: number;
  lockVersion: number;
  updatedAt: string;
  modifierContractMode?: ModifierContractMode;
  modifierGroupLinks?: ItemModifierGroupLink[];
  sizes: AdminModifierInput[];
  addons: AdminModifierInput[];
  upgradeOptions: AdminUpgradeOptionInput[];
};

export type Category = {
  id: string;
  slug: string;
  name: string;
  icon: string;
  sortOrder: number;
  isActive: boolean;
};

export type HeroPending = {
  heroFile: File | null;
  removeHero: boolean;
};

export type ModalMode = "create" | "edit";

export type SaveResult =
  | { ok: true; item: Item }
  | { ok: false; error: string; conflict?: boolean };

export type SharedModifierItemMutationResult =
  | { ok: true; item: Item; message?: string }
  | { ok: false; error: string; conflict?: boolean };

export type WorkspaceAddOnManagerFocus = {
  source: "item-editor-stock";
  itemId: string;
  itemName: string;
  itemLinkId: string;
  groupId: string;
  optionIds: string[];
  itemGroupIds?: string[];
  itemOptionIdsByGroupId?: Record<string, string[]>;
  highlightOptionId?: string;
};

export type SharedModifierWorkspaceControls = {
  groups: SharedModifierGroup[];
  busyKey: string | null;
  onOpenLibrary?: (
    groupId?: string,
    focus?: WorkspaceAddOnManagerFocus
  ) => void | Promise<void>;
};

export type EditModalSharedProps = {
  mode: ModalMode;
  item: Item;
  categories: Category[];
  allowedImageHosts: string[];
  saving: boolean;
  busyDeleting: boolean;
  onSave: (draft: Item, hero: HeroPending) => Promise<SaveResult>;
  onHide: () => Promise<Item | void>;
  onDelete: () => Promise<void>;
  onHardDelete?: () => Promise<void>;
  onCancel: () => void;
  // RBAC gate. When false, footer Save/Hide/Delete/Hard-delete are hidden,
  // ⌘/Ctrl+S no-ops via canSave, and the Live/Hidden + In/Out Stock toggles
  // render disabled with a "Read-only access" tooltip. Modal mounts in
  // MenuEditor are also gated on this flag as defense in depth.
  canWriteMenu: boolean;
  sharedModifiers?: SharedModifierWorkspaceControls;
};

export type {
  AdminModifierInput,
  AdminUpgradeOptionInput,
  AdminUpgradeItemLinkInput,
};
