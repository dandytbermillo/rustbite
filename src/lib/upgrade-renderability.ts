// Shared filter for "is this UpgradeOption visible to customers / acceptable at
// checkout?" Used by:
//   - api/menu/route.ts (kiosk hydration filter)
//   - lib/checkout.ts  (server-side rejection of crafted/stale upgrade ids)
//
// The cart-rebuild path in app/kiosk/page.tsx relies on the kiosk DTO already
// being filtered through this helper server-side; absence-from-DTO is the
// client-side equivalent of "not renderable" (see plan step 14).

import {
  isMenuItemAvailable,
  type MenuStockMode,
} from "@/lib/menu-availability";

export type UpgradeRenderabilityLink = {
  linkedMenuItemId: string | null;
  linkedSizeId: string | null;
  sizeNameSnapshot: string | null;
  linkedMenuItem:
    | {
        isActive: boolean;
        isOutOfStock: boolean;
        stockMode?: MenuStockMode | null;
        stockQty?: number | null;
        sizes: ReadonlyArray<{ id: string }>;
      }
    | null;
};

export type UpgradeRenderabilityOption = {
  linkedItems: ReadonlyArray<UpgradeRenderabilityLink>;
};

export function isUpgradeLinkCustomerRenderable(
  link: UpgradeRenderabilityLink
): boolean {
  // Hard-delete cascade SetNull cleared the parent ref.
  if (link.linkedMenuItemId == null || link.linkedMenuItem == null) return false;

  // Soft-deactivated parent.
  if (!link.linkedMenuItem.isActive) return false;

  // Visible-but-unavailable linked items are hidden from customer-facing
  // upgrade contents. They should not hide the whole upgrade if another linked
  // item remains available.
  if (!isMenuItemAvailable(link.linkedMenuItem)) return false;

  // Sticky size lost: link was originally size-specific, but the SizeOption
  // was deleted (cascade SetNull). The frozen sizeNameSnapshot is still set
  // but linkedSizeId is null.
  if (link.sizeNameSnapshot != null && link.linkedSizeId == null) return false;

  // Linked item gained sizes since the link was created without one.
  if (link.sizeNameSnapshot == null && link.linkedMenuItem.sizes.length > 0) {
    return false;
  }

  return true;
}

export function getRenderableUpgradeLinks<T extends UpgradeRenderabilityLink>(
  option: { linkedItems: ReadonlyArray<T> }
): T[] {
  return option.linkedItems.filter(isUpgradeLinkCustomerRenderable);
}

export function isUpgradeRenderable(option: UpgradeRenderabilityOption): boolean {
  return getRenderableUpgradeLinks(option).length > 0;
}
