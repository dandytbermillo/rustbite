import { prisma } from "@/lib/db";
import { redirect } from "next/navigation";
import { getAppSettings } from "@/lib/app-settings";
import {
  adminActorHasPermission,
  requireAdminPagePermission,
} from "@/lib/admin-sessions";
import { loadDealHistoryEntries } from "@/lib/deal-history";
import { resolveAllowedImageHosts } from "@/lib/image-urls";
import { DEFAULT_OUTLET_ID } from "@/lib/outlets";
import {
  menuHistoryStateIdForOutlet,
  parseMenuSnapshot,
  summarizeMenuSnapshot,
} from "@/lib/menu-history";
import { getOutletMenuVersion } from "@/lib/outlet-menu-sync";
import { isS3StorageConfigured } from "@/lib/storage";
import { getStorageMode } from "@/lib/storage-driver";
import { ensureLocalStorageReady } from "@/lib/storage-local";
import { classicDeepLinkToWorkspaceTarget } from "@/lib/admin/workspace/deep-links";
import type { ImageFit } from "@/lib/types";
import AdminShell from "@/components/admin/Shell";
import MenuEditor from "./MenuEditor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function normalizeImageFit(value: string | null | undefined): ImageFit {
  return value === "CONTAIN" ? "CONTAIN" : "COVER";
}

type SearchParams = Promise<{
  mode?: string;
  id?: string;
  item?: string;
  q?: string;
  category?: string | string[];
  attention?: string | string[];
  badge?: string;
  status?: string;
  stock?: string;
}>;

function toUrlSearchParams(params: Awaited<SearchParams>): URLSearchParams {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (item) next.append(key, item);
      }
    } else if (value) {
      next.set(key, value);
    }
  }
  return next;
}

export default async function AdminMenuPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const permission = await requireAdminPagePermission("admin.menu.read");
  const sp = await searchParams;
  const workspaceTarget = classicDeepLinkToWorkspaceTarget({
    pathname: "/admin/menu",
    searchParams: toUrlSearchParams(sp),
  });
  if (workspaceTarget) redirect(workspaceTarget);

  const outletId = permission?.outletId ?? DEFAULT_OUTLET_ID;
  // Resolve write/restore capability so the UI can hide affordances that
  // would otherwise produce server 403s for read-only users (Staff VIEWER).
  // Legacy basic-auth path (`permission === null` after a reached page)
  // bypasses outlet scoping and acts as a wildcard admin — both flags true.
  const canWriteMenu = permission
    ? await adminActorHasPermission(
        permission.actor,
        "admin.menu.write",
        permission.outletId,
      )
    : true;
  const canRestoreMenu = permission
    ? await adminActorHasPermission(
        permission.actor,
        "admin.menu.restore",
        permission.outletId,
      )
    : true;
  const menuHistoryStateId = menuHistoryStateIdForOutlet(outletId);
  const [
    categories,
    items,
    auditLogs,
    revisions,
    historyState,
    appSettings,
    dealHistoryEntries,
    menuVersion,
  ] = await Promise.all([
    prisma.category.findMany({
      where: { outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    }),
    prisma.menuItem.findMany({
      where: { outletId },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      include: {
        sizes: { orderBy: { sortOrder: "asc" } },
        addons: { orderBy: { sortOrder: "asc" } },
        // Admin hydration is intentionally UNFILTERED — broken/null/inactive
        // links must surface so the editor can render repair affordances.
        // Don't apply isUpgradeRenderable here (kiosk-only).
        upgradeOptions: {
          orderBy: { sortOrder: "asc" },
          include: {
            linkedItems: {
              orderBy: { sortOrder: "asc" },
              include: {
                linkedMenuItem: {
                  select: {
                    id: true,
                    name: true,
                    emoji: true,
                    bgColor: true,
                    isActive: true,
                    isOutOfStock: true,
                    stockMode: true,
                    stockQty: true,
                    price: true,
                    sizes: { select: { id: true } },
                  },
                },
                linkedSize: { select: { id: true, name: true, priceDelta: true } },
              },
            },
          },
        },
      },
    }),
    prisma.menuAuditLog.findMany({
      where: { outletId },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.menuRevision.findMany({
      where: {
        outletId,
        reason: {
          not: "MENU_RESTORED",
        },
      },
      orderBy: { createdAt: "desc" },
      take: 12,
    }),
    prisma.menuHistoryState.findUnique({
      where: { id: menuHistoryStateId },
      select: { currentRevisionId: true },
    }),
    getAppSettings(),
    loadDealHistoryEntries({ limit: 100, outletId }),
    getOutletMenuVersion(prisma, outletId),
  ]);

  const fallbackLiveRevisionId = revisions[0]?.id ?? null;
  const currentLiveRevisionId = historyState?.currentRevisionId ?? fallbackLiveRevisionId;

  const currentRevisionMissingFromWindow =
    !!currentLiveRevisionId && !revisions.some((entry) => entry.id === currentLiveRevisionId);
  const [currentLiveRevision, latestRestoreForCurrent] = await Promise.all([
    currentRevisionMissingFromWindow
      ? prisma.menuRevision.findFirst({
          where: { id: currentLiveRevisionId!, outletId },
        })
      : Promise.resolve(null),
    currentLiveRevisionId
      ? prisma.menuAuditLog.findFirst({
          where: {
            outletId,
            actionType: "MENU_RESTORED",
            targetId: currentLiveRevisionId,
          },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        })
      : Promise.resolve(null),
  ]);

  const mergedRevisions = [...(currentLiveRevision ? [currentLiveRevision] : []), ...revisions]
    .filter(
      (entry, index, array) =>
        array.findIndex((candidate) => candidate.id === entry.id) === index
    )
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  const categoryRows = categories.map((category) => ({
    id: category.id,
    slug: category.slug,
    name: category.name,
    icon: category.icon,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    updatedAt: category.updatedAt.toISOString(),
  }));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  const itemRows = items.map((i) => {
    const isDeal = categoryById.get(i.categoryId)?.slug === "deals";
    const upgradeOptions = isDeal ? i.upgradeOptions : [];
    return {
      id: i.id,
      categoryId: i.categoryId,
      comboNum: i.comboNum,
      name: i.name,
      description: i.description,
      price: Number(i.price),
      emoji: i.emoji,
      bgColor: i.bgColor,
      badge: i.badge,
      bundleSavings:
        i.bundleSavings != null
          ? Number(i.bundleSavings)
          : i.mealSavings != null
          ? Number(i.mealSavings)
          : null,
      dealBaseMenuItemId: i.dealBaseMenuItemId,
      dealBaseSizeId: i.dealBaseSizeId,
      dealBaseSizeNameSnapshot: i.dealBaseSizeNameSnapshot,
      dealStartsAt: i.dealStartsAt?.toISOString() ?? null,
      dealLimitMode: i.dealLimitMode,
      dealLimitQty: i.dealLimitQty,
      dealLimitLowThreshold: i.dealLimitLowThreshold,
      dealLimitUpdatedAt: i.dealLimitUpdatedAt?.toISOString() ?? null,
      dealLimitUpdatedById: i.dealLimitUpdatedById,
      imageUrl: i.imageUrl,
      imageAlt: i.imageAlt,
      imageFit: normalizeImageFit(i.imageFit),
      cardImageUrl: i.cardImageUrl,
      cardImageAlt: i.cardImageAlt,
      dealExpiresAt: i.dealExpiresAt?.toISOString() ?? null,
      isActive: i.isActive,
      isOutOfStock: i.isOutOfStock,
      stockMode: i.stockMode,
      stockQty: i.stockQty,
      lowStockThreshold: i.lowStockThreshold,
      stockUpdatedAt: i.stockUpdatedAt?.toISOString() ?? null,
      stockUpdatedById: i.stockUpdatedById,
      sortOrder: i.sortOrder,
      lockVersion: i.lockVersion,
      updatedAt: i.updatedAt.toISOString(),
      sizes: i.sizes.map((s) => ({
        id: s.id,
        name: s.name,
        priceDelta: Number(s.priceDelta),
      })),
      addons: i.addons.map((a) => ({
        id: a.id,
        name: a.name,
        priceDelta: Number(a.priceDelta),
      })),
      upgradeOptions: upgradeOptions.map((upgrade) => ({
        id: upgrade.id,
        customTitle: upgrade.customTitle,
        extraCharge: Number(upgrade.extraCharge),
        savingsLabel:
          upgrade.savingsLabel != null ? Number(upgrade.savingsLabel) : null,
        discountPct:
          upgrade.discountPct != null ? Number(upgrade.discountPct) : null,
        sortOrder: upgrade.sortOrder,
        linkedItems: upgrade.linkedItems.map((link) => ({
          id: link.id,
          linkedMenuItemId: link.linkedMenuItemId,
          linkedSizeId: link.linkedSizeId,
          itemNameSnapshot: link.itemNameSnapshot,
          sizeNameSnapshot: link.sizeNameSnapshot,
          sortOrder: link.sortOrder,
          linkedMenuItem: link.linkedMenuItem
            ? {
                id: link.linkedMenuItem.id,
                name: link.linkedMenuItem.name,
                emoji: link.linkedMenuItem.emoji,
                bgColor: link.linkedMenuItem.bgColor,
                isActive: link.linkedMenuItem.isActive,
                isOutOfStock: link.linkedMenuItem.isOutOfStock,
                stockMode: link.linkedMenuItem.stockMode,
                stockQty: link.linkedMenuItem.stockQty,
                price: Number(link.linkedMenuItem.price),
                sizeCount: link.linkedMenuItem.sizes.length,
              }
            : null,
          linkedSize: link.linkedSize
            ? {
                id: link.linkedSize.id,
                name: link.linkedSize.name,
                priceDelta: Number(link.linkedSize.priceDelta),
              }
            : null,
        })),
      })),
    };
  });

  const auditRows = auditLogs.map((entry) => ({
    id: entry.id,
    actionType: entry.actionType,
    targetType: entry.targetType,
    targetId: entry.targetId,
    targetLabel: entry.targetLabel,
    actorType: entry.actorType,
    actorIdentity: entry.actorIdentity,
    createdAt: entry.createdAt.toISOString(),
  }));

  const revisionRows = mergedRevisions.map((entry) => {
    const snapshot = parseMenuSnapshot(entry.snapshot);
    const summary = summarizeMenuSnapshot(snapshot);

    return {
      id: entry.id,
      reason: entry.reason,
      actorType: entry.actorType,
      actorIdentity: entry.actorIdentity,
      sourceRevisionId: entry.sourceRevisionId,
      createdAt: entry.createdAt.toISOString(),
      targetLabel: entry.targetLabel,
      targetType: entry.targetType,
      summary,
    };
  });

  const allowedImageHosts = resolveAllowedImageHosts(
    process.env.NEXT_PUBLIC_IMAGE_CDN_BASE,
    process.env.IMAGE_PASTE_URL_ALLOWLIST
  );
  const allowPasteUrl = !!process.env.IMAGE_PASTE_URL_ALLOWLIST?.trim();

  const storageMode = getStorageMode();
  let storageConfigured: boolean;
  let storageDisabledReason: string | null = null;
  if (storageMode === "local") {
    const ready = await ensureLocalStorageReady();
    storageConfigured = ready.ok;
    storageDisabledReason = ready.ok ? null : ready.reason;
  } else {
    storageConfigured = isS3StorageConfigured();
    storageDisabledReason = storageConfigured
      ? null
      : "Image upload is disabled — set IMAGE_BUCKET_* and NEXT_PUBLIC_IMAGE_CDN_BASE in env to enable uploads.";
  }

  return (
    <AdminShell active="menu">
      <MenuEditor
        categories={categoryRows}
        items={itemRows}
        auditLogs={auditRows}
        revisions={revisionRows}
        currentLiveRevisionId={currentLiveRevisionId}
        serverNowIso={new Date().toISOString()}
        currentLiveRestoredAt={latestRestoreForCurrent?.createdAt.toISOString() ?? null}
        allowedImageHosts={allowedImageHosts}
        allowPasteUrl={allowPasteUrl}
        storageConfigured={storageConfigured}
        storageDisabledReason={storageDisabledReason}
        dealDefaultDiscountPct={appSettings.dealDefaultDiscountPct}
        dealHistoryEntries={dealHistoryEntries}
        canWriteMenu={canWriteMenu}
        canRestoreMenu={canRestoreMenu}
        initialMenuVersion={menuVersion}
      />
    </AdminShell>
  );
}
