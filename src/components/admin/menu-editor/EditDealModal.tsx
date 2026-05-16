"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsDown, ChevronsUp, Eye, EyeOff } from "lucide-react";
import { BRAND } from "@/lib/brand";
import {
  DEFAULT_DEAL_START_TIME,
  DEFAULT_DEAL_EXPIRATION_TIME_LABEL,
  dealScheduleIsoForLocalDateTime,
  dealSchedulePresetToday,
  dealSchedulePresetTomorrow,
  defaultDealEndIso,
  defaultDealStartIso,
  isOnlyTodayPresetAvailable,
  toDealScheduleDateInputValue,
  toDealScheduleTimeInputValue,
  validateDealSchedule,
} from "@/lib/deal-schedule";
import { isMenuItemAvailable } from "@/lib/menu-availability";
import {
  dealExpirationState as sharedDealExpirationState,
  dealExpirationSummary as sharedDealExpirationSummary,
  type Item as VisibilityItem,
} from "@/lib/admin/menu/visibility";
import ModalShell from "./ModalShell";
import VisibilityRow from "./VisibilityRow";
import UpgradeOptionEditor from "./UpgradeOptionEditor";
import KioskDealPreview from "./KioskDealPreview";
import LinkedItemPicker, { type PickerItem } from "./LinkedItemPicker";
import type {
  AdminUpgradeItemLinkInput,
  AdminUpgradeOptionInput,
  EditModalSharedProps,
  HeroPending,
  Item,
} from "./types";

type Props = EditModalSharedProps & {
  // The site-wide default discount %, from AppSettings.
  defaultDiscountPct?: number;
  // All menu items in the store. Used internally to (a) populate the
  // LinkedItemPicker, and (b) resolve linkedMenuItemId/linkedSizeId pairs
  // into display rows in the upgrade card.
  allItems: Item[];
};

const DEAL_FORM_SECTIONS = [
  { id: "availability", label: "Availability" },
  { id: "base", label: "Base item" },
  { id: "options", label: "Deal options" },
] as const;

type DealFormSectionId = (typeof DEAL_FORM_SECTIONS)[number]["id"];

const COLLAPSED_FOR_EXISTING_DEAL = new Set<DealFormSectionId>([
  "availability",
  "base",
  "options",
]);

const DEAL_LIMIT_MAX_QTY = 99999;

function newTempId(prefix: string): string {
  return `new-${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildBaseLink(
  base: Item,
  sizeId: string | null = null,
): AdminUpgradeItemLinkInput {
  const selectedSize = sizeId
    ? (base.sizes.find((size) => size.id === sizeId) ?? null)
    : null;
  const firstSize = selectedSize ?? base.sizes.find((size) => !!size.id) ?? null;
  return {
    id: newTempId("link"),
    linkedMenuItemId: base.id,
    linkedSizeId: firstSize?.id ?? null,
    itemNameSnapshot: base.name,
    sizeNameSnapshot: firstSize?.name ?? null,
    sortOrder: 0,
  };
}

// Deal modal — matches the proposal at
// `docs/proposal/menu-editor-modal-redesign.html`. Sections are intentionally
// minimal: a deal inherits its name, description, price, emoji, bgColor,
// badge, combo number, and image from its base menu item, so this modal
// only edits the deal-specific fields:
//   1. Visibility + schedule
//   2. Add-ons (rare for deals)
//   3. Upgrade option (focal)
// To change a deal's basics, swap its base item via the legacy create flow.
export default function EditDealModal(props: Props) {
  const {
    mode,
    item,
    categories,
    onCancel,
    onSave,
    onDelete,
    onHardDelete,
    saving,
    busyDeleting,
    defaultDiscountPct = 12,
    allItems,
    canWriteMenu,
  } = props;

  const [draft, setDraft] = useState<Item>(item);
  // Hero pending state is preserved so save passes the empty value through;
  // the deal modal never opens an image-upload UI.
  const [heroPending] = useState<HeroPending>({
    heroFile: null,
    removeHero: false,
  });
  const [error, setError] = useState<string | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pickerForBase, setPickerForBase] = useState(false);
  // Picker state — non-null index = open, targeting that upgrade option.
  const [pickerForUpgrade, setPickerForUpgrade] = useState<number | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<{
    upgradeIndex: number;
    linkIndex: number;
  } | null>(null);
  const [previewVisible, setPreviewVisible] = useState(true);
  const sectionRefs = useRef<
    Partial<Record<DealFormSectionId, HTMLElement | null>>
  >({});
  const [selectedSectionId, setSelectedSectionId] =
    useState<DealFormSectionId | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<
    Set<DealFormSectionId>
  >(() =>
    mode === "edit" ? new Set(COLLAPSED_FOR_EXISTING_DEAL) : new Set(),
  );
  const dirty = JSON.stringify(draft) !== JSON.stringify(item);

  useEffect(() => {
    setDraft(item);
    setError(null);
    setConflictMsg(null);
    setConfirmingDelete(false);
    setPickerForBase(false);
    setPickerForUpgrade(null);
    setReplaceTarget(null);
    setPreviewVisible(true);
    setSelectedSectionId(null);
    setCollapsedSections(
      mode === "edit" ? new Set(COLLAPSED_FOR_EXISTING_DEAL) : new Set(),
    );
  }, [item.id, mode]);

  // Auto-create one blank upgrade option for new deals so operators land on
  // something to fill in instead of an empty section. (Reached only when a
  // new deal is opened in the new modal, which today routes through the
  // legacy modal — kept defensively.)
  useEffect(() => {
    if (mode === "create" && draft.upgradeOptions.length === 0) {
      setDraft((d) => ({
        ...d,
        upgradeOptions: [
          {
            customTitle: null,
            extraCharge: 0,
            savingsLabel: null,
            discountPct: defaultDiscountPct,
            sortOrder: 0,
            linkedItems: [],
          },
        ],
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!confirmingDelete) return;
    const t = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingDelete]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  // Map of all items + sizes for fast lookup when resolving upgrade links.
  const itemMap = useMemo(
    () => new Map(allItems.map((it) => [it.id, it])),
    [allItems]
  );
  const sizeIndex = useMemo(() => {
    const map = new Map<
      string,
      { itemId: string; name: string; priceDelta: number }
    >();
    for (const it of allItems) {
      for (const size of it.sizes) {
        if (size.id) map.set(size.id, { itemId: it.id, ...size });
      }
    }
    return map;
  }, [allItems]);
  const categoryMap = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories]
  );
  const dealCategoryIds = useMemo(
    () =>
      new Set(
        categories.filter((category) => category.slug === "deals").map((c) => c.id)
      ),
    [categories]
  );
  const baseItem = draft.dealBaseMenuItemId
    ? itemMap.get(draft.dealBaseMenuItemId) ?? null
    : null;
  const baseSize =
    baseItem && draft.dealBaseSizeId
      ? (baseItem.sizes.find((size) => size.id === draft.dealBaseSizeId) ?? null)
      : null;
  const baseSizeName =
    baseSize?.name ?? draft.dealBaseSizeNameSnapshot ?? null;
  const basePriceWithSize = baseItem
    ? baseItem.price + (baseSize?.priceDelta ?? 0)
    : null;
  const baseRepair = (() => {
    if (!draft.dealBaseMenuItemId) {
      return {
        blocksSave: true,
        message: "Choose the real non-deal base item before saving this deal.",
      };
    }
    if (draft.dealBaseMenuItemId === draft.id) {
      return {
        blocksSave: true,
        message: "The base item cannot point to this deal. Choose the real base item.",
      };
    }
    if (!baseItem) {
      return {
        blocksSave: true,
        message: "The saved base item no longer exists. Choose a replacement.",
      };
    }
    if (dealCategoryIds.has(baseItem.categoryId)) {
      return {
        blocksSave: true,
        message: "The base item points to another deal. Choose a real menu item.",
      };
    }
    if (draft.dealBaseSizeId && !baseSize) {
      return {
        blocksSave: true,
        message: "The saved base size no longer belongs to the base item. Choose the base again.",
      };
    }
    if (!baseItem.isActive) {
      return {
        blocksSave: false,
        message: "Base item is hidden, so this deal will stay hidden until the base is live.",
      };
    }
    if (!isMenuItemAvailable(baseItem)) {
      return {
        blocksSave: false,
        message:
          "Base item is out of stock, so this deal will stay hidden until it is restocked.",
      };
    }
    return null;
  })();

  function resolveLinkPreview(link: AdminUpgradeItemLinkInput) {
    const it = link.linkedMenuItemId ? itemMap.get(link.linkedMenuItemId) : null;
    const sz = link.linkedSizeId ? sizeIndex.get(link.linkedSizeId) : null;
    if (!it) {
      return {
        id: link.linkedMenuItemId ?? "",
        emoji: "❓",
        name: link.itemNameSnapshot ?? "Unknown item",
        size: null,
        price: null,
        isOutOfStock: true,
        blocksSave: true,
        repairMessage: "Missing item — replace or remove",
      };
    }
    if (dealCategoryIds.has(it.categoryId)) {
      return {
        id: it.id,
        emoji: it.emoji,
        name: it.name,
        size: null,
        price: null,
        isOutOfStock: true,
        blocksSave: true,
        repairMessage: "Linked to another deal — replace or remove",
      };
    }
    if (
      link.linkedSizeId &&
      (!sz || sz.itemId !== it.id)
    ) {
      return {
        id: it.id,
        emoji: it.emoji,
        name: it.name,
        size: link.sizeNameSnapshot ?? null,
        price: null,
        isOutOfStock: true,
        blocksSave: true,
        repairMessage: "Invalid size — replace or remove",
      };
    }
    if (link.sizeNameSnapshot != null && link.linkedSizeId == null) {
      return {
        id: it.id,
        emoji: it.emoji,
        name: it.name,
        size: link.sizeNameSnapshot,
        price: null,
        isOutOfStock: true,
        blocksSave: true,
        repairMessage: "Missing size — replace or remove",
      };
    }
    if (link.sizeNameSnapshot == null && it.sizes.length > 0 && !link.linkedSizeId) {
      return {
        id: it.id,
        emoji: it.emoji,
        name: it.name,
        size: null,
        price: null,
        isOutOfStock: true,
        blocksSave: true,
        repairMessage: "Choose a size — replace or remove",
      };
    }
    const itemAvailable = isMenuItemAvailable(it);
    const unavailableMessage = !it.isActive
      ? "Linked item is hidden — hidden from customers"
      : !itemAvailable
      ? "Out of stock — hidden from customers"
      : undefined;
    return {
      id: it.id,
      emoji: it.emoji,
      name: it.name,
      size: sz?.name ?? null,
      price: it.price + (sz?.priceDelta ?? 0),
      isOutOfStock: !itemAvailable,
      repairMessage: unavailableMessage,
    };
  }

  function dealOptionPreview(option: AdminUpgradeOptionInput) {
    const linkPreviews = option.linkedItems.map(resolveLinkPreview);
    const complete =
      linkPreviews.length > 0 &&
      linkPreviews.every(
        (preview) => !preview.blocksSave && !preview.isOutOfStock
      );
    const itemsTotal = complete
      ? linkPreviews.reduce((sum, preview) => sum + (preview.price ?? 0), 0)
      : 0;
    const pct = option.discountPct ?? defaultDiscountPct;
    const save = +(itemsTotal * pct / 100).toFixed(2);
    const customerPays = +(itemsTotal - save).toFixed(2);
    return {
      complete,
      customerPays,
      save,
      included: complete
        ? linkPreviews.map((preview) => ({
            emoji: preview.emoji,
            name: preview.name,
            size: preview.size,
          }))
        : [],
    };
  }

  // Deal schedule is routed through the shared helpers so the modal,
  // customer menu, checkout, and menu list agree on deal lifecycle.
  const scheduleValidation = useMemo(() => {
    return validateDealSchedule({
      startsAt: draft.dealStartsAt,
      expiresAt: draft.dealExpiresAt,
    });
  }, [draft.dealStartsAt, draft.dealExpiresAt]);
  const expirationState = useMemo(() => {
    return sharedDealExpirationState(
      {
        dealStartsAt: draft.dealStartsAt,
        dealExpiresAt: draft.dealExpiresAt,
      } as VisibilityItem,
      Date.now(),
    );
  }, [draft.dealStartsAt, draft.dealExpiresAt]);
  const daysLeft = useMemo(() => {
    if (!draft.dealExpiresAt) return null;
    return sharedDealExpirationSummary(
      {
        dealStartsAt: draft.dealStartsAt,
        dealExpiresAt: draft.dealExpiresAt,
      } as VisibilityItem,
      Date.now(),
    );
  }, [draft.dealStartsAt, draft.dealExpiresAt]);

  const dealLimitMode = draft.dealLimitMode ?? "UNLIMITED";
  const dealLimitQty = draft.dealLimitQty ?? null;
  const dealLimitLowThreshold = draft.dealLimitLowThreshold ?? null;
  const dealLimitQtyValid =
    dealLimitMode === "UNLIMITED" ||
    (Number.isInteger(dealLimitQty) &&
      (dealLimitQty as number) >= 0 &&
      (dealLimitQty as number) <= DEAL_LIMIT_MAX_QTY);
  const dealLimitLowThresholdValid =
    dealLimitLowThreshold == null ||
    (Number.isInteger(dealLimitLowThreshold) &&
      dealLimitLowThreshold >= 0 &&
      dealLimitLowThreshold <= DEAL_LIMIT_MAX_QTY);
  const dealLimitValid = dealLimitQtyValid && dealLimitLowThresholdValid;
  const dealLimitSummary =
    dealLimitMode === "LIMITED"
      ? `${dealLimitQty ?? 0} deal sale${(dealLimitQty ?? 0) === 1 ? "" : "s"} left`
      : "Unlimited deal sales";

  const expirationValid = scheduleValidation.ok;
  const upgradeValid = draft.upgradeOptions.length > 0;
  const structuralRepairMessages = [
    ...(baseRepair?.blocksSave ? [baseRepair.message] : []),
    ...draft.upgradeOptions.flatMap((option) =>
      option.linkedItems
        .map(resolveLinkPreview)
        .filter((preview) => preview.blocksSave)
        .map((preview) => preview.repairMessage ?? "Repair linked item")
    ),
  ];
  // canSave folds canWriteMenu so the ⌘/Ctrl+S keyboard path is also gated,
  // not just the visible Save button. Existing deal-specific checks
  // (expirationValid, upgradeValid, structuralRepairMessages) are preserved.
  const canSave =
    !saving &&
    expirationValid &&
    dealLimitValid &&
    upgradeValid &&
    structuralRepairMessages.length === 0 &&
    canWriteMenu;

  // Compute the customer-facing upgrade-card preview from the first complete
  // option. Deals are all-or-nothing bundles: one unavailable required
  // component hides that option instead of showing a partial bundle.
  const previewModel = useMemo(() => {
    for (const option of draft.upgradeOptions) {
      const optionPreview = dealOptionPreview(option);
      if (!optionPreview.complete) continue;
      return {
        headline: `ADD ${optionPreview.included
          .map((preview) => preview.name)
          .join(" + ")
          .toUpperCase()}`,
        customerPays: optionPreview.customerPays,
        save: optionPreview.save,
        included: optionPreview.included,
        hasCompleteOption: true,
      };
    }
    return {
      headline: "NO COMPLETE UPGRADE",
      customerPays: 0,
      save: 0,
      included: [] as Array<{
        emoji: string;
        name: string;
        size: string | null;
      }>,
      hasCompleteOption: false,
    };
  }, [draft.upgradeOptions, defaultDiscountPct, allItems]);
  const effectivelyLive =
    draft.isActive &&
    expirationState === "active" &&
    structuralRepairMessages.length === 0 &&
    previewModel.hasCompleteOption &&
    !baseRepair;
  const visibilityDraftChanged = draft.isActive !== item.isActive;
  const previewHeading = (() => {
    if (visibilityDraftChanged) {
      if (!draft.isActive) return "Will hide after save";
      return effectivelyLive ? "Will show after save" : "Customers will not see this";
    }
    return effectivelyLive ? "Customers will see this" : "Customers will not see this";
  })();
  const pendingVisibilityMessage = (() => {
    if (!visibilityDraftChanged) return null;
    if (draft.isActive) {
      return "Not saved yet. Click Save deal to remove the manual hide. Until then, customers still see the saved version if it is currently live.";
    }
    return "Not saved yet. Click Save deal to hide this deal from the kiosk. Until then, customers still see the saved version if it is currently live.";
  })();
  const previewHiddenReason = (() => {
    if (!draft.isActive) {
      return pendingVisibilityMessage ?? "This deal is manually hidden.";
    }
    if (!scheduleValidation.ok) {
      return scheduleValidation.message;
    }
    if (expirationState === "missing") {
      return "Set a deal end time before customers can see this deal.";
    }
    if (expirationState === "invalid") return "Fix the deal schedule before customers can see this deal.";
    if (expirationState === "scheduled") return "This deal is scheduled for later.";
    if (expirationState === "expired") return "This deal has expired.";
    if (baseRepair) return baseRepair.message;
    if (structuralRepairMessages.length > 0) return structuralRepairMessages[0];
    if (!previewModel.hasCompleteOption) {
      return "At least one complete in-stock deal option is required before customers can see this deal.";
    }
    return "This deal is hidden from the kiosk.";
  })();
  const availabilitySummary = [
    visibilityDraftChanged
      ? draft.isActive && effectivelyLive
        ? "Will show after save"
        : draft.isActive
          ? "Manual hide will be removed after save"
          : "Will hide after save"
      : effectivelyLive
        ? "Live on kiosk"
        : "Hidden from kiosk",
    dealLimitSummary,
    scheduleValidation.ok
      ? expirationState === "expired"
        ? "Expired"
        : daysLeft ?? null
      : scheduleValidation.status === "missing"
        ? "No end time"
        : "Invalid schedule",
  ]
    .filter(Boolean)
    .join(" · ");
  const baseSummary = baseItem
    ? `${baseItem.emoji} ${baseItem.name}${
        baseSizeName ? ` · ${baseSizeName}` : baseItem.sizes.length > 0 ? " · size not selected" : ""
      } · $${(basePriceWithSize ?? baseItem.price).toFixed(2)}`
    : "No base item selected";
  const completeOptionPreviews = draft.upgradeOptions
    .map(dealOptionPreview)
    .filter((optionPreview) => optionPreview.complete);
  const completeOptionCount = completeOptionPreviews.length;
  const optionSummary = (() => {
    const optionWord = completeOptionCount === 1 ? "option" : "options";
    const completionSummary =
      completeOptionCount === draft.upgradeOptions.length
        ? `${completeOptionCount} complete ${optionWord}`
        : `${completeOptionCount} of ${draft.upgradeOptions.length} complete`;

    if (completeOptionCount === 0) {
      return completionSummary;
    }

    if (completeOptionCount === 1) {
      const [optionPreview] = completeOptionPreviews;
      return `${completionSummary} · Customer pays $${optionPreview.customerPays.toFixed(
        2,
      )} · Saves $${optionPreview.save.toFixed(2)}`;
    }

    const customerPaysValues = completeOptionPreviews.map(
      (optionPreview) => optionPreview.customerPays,
    );
    const savingsValues = completeOptionPreviews.map(
      (optionPreview) => optionPreview.save,
    );
    const minCustomerPays = Math.min(...customerPaysValues);
    const maxCustomerPays = Math.max(...customerPaysValues);
    const minSavings = Math.min(...savingsValues);
    const maxSavings = Math.max(...savingsValues);
    const customerPaysSummary =
      minCustomerPays === maxCustomerPays
        ? `$${minCustomerPays.toFixed(2)}`
        : `$${minCustomerPays.toFixed(2)}-$${maxCustomerPays.toFixed(2)}`;
    const savingsSummary =
      minSavings === maxSavings
        ? `$${minSavings.toFixed(2)}`
        : `$${minSavings.toFixed(2)}-$${maxSavings.toFixed(2)}`;

    return `${completionSummary} · Customer pays ${customerPaysSummary} · Saves ${savingsSummary}`;
  })();
  const optionSummaryLines = draft.upgradeOptions.slice(0, 3).map((option) => {
    const customTitle = option.customTitle?.trim();
    const linkPreviews = option.linkedItems.map(resolveLinkPreview);
    const complete =
      linkPreviews.length > 0 &&
      linkPreviews.every(
        (preview) => !preview.blocksSave && !preview.isOutOfStock,
      );
    const title =
      customTitle ||
      (linkPreviews.length > 0
        ? `Add ${linkPreviews.map((preview) => preview.name).join(" + ")}`
        : "No required items");
    return `${title}${complete ? "" : " · incomplete"}`;
  });
  const invalidSectionIds = useMemo(() => {
    const invalid = new Set<DealFormSectionId>();
    if (!expirationValid || !dealLimitValid) invalid.add("availability");
    if (baseRepair?.blocksSave) invalid.add("base");
    if (!upgradeValid || structuralRepairMessages.length > 0 || !previewModel.hasCompleteOption) {
      invalid.add("options");
    }
    return invalid;
  }, [
    baseRepair?.blocksSave,
    dealLimitValid,
    expirationValid,
    previewModel.hasCompleteOption,
    structuralRepairMessages.length,
    upgradeValid,
  ]);
  const allCollapsibleSectionsCollapsed = useMemo(
    () =>
      DEAL_FORM_SECTIONS.every(
        (section) =>
          invalidSectionIds.has(section.id) ||
          collapsedSections.has(section.id),
      ),
    [collapsedSections, invalidSectionIds],
  );

  useEffect(() => {
    if (invalidSectionIds.size === 0) return;
    setCollapsedSections((current) => {
      let changed = false;
      const next = new Set(current);
      for (const id of invalidSectionIds) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : current;
    });
  }, [invalidSectionIds]);

  function setSectionRef(id: DealFormSectionId, node: HTMLElement | null) {
    sectionRefs.current[id] = node;
  }

  function toggleSection(id: DealFormSectionId) {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function scrollToSection(id: DealFormSectionId) {
    setCollapsedSections((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
    setSelectedSectionId(id);
    window.requestAnimationFrame(() => {
      sectionRefs.current[id]?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  }

  function collapseAllSections() {
    setCollapsedSections(
      new Set(
        DEAL_FORM_SECTIONS
          .map((section) => section.id)
          .filter((id) => !invalidSectionIds.has(id)),
      ),
    );
    setSelectedSectionId(null);
  }

  function expandAllSections() {
    setCollapsedSections(new Set());
    setSelectedSectionId(null);
  }

  // PickerItem[] for the LinkedItemPicker. Excludes the current draft to
  // prevent self-reference in upgrade links.
  const pickerItems = useMemo<PickerItem[]>(() => {
    return allItems
      .filter((it) => it.id !== draft.id && !dealCategoryIds.has(it.categoryId))
      .map((it) => {
        const cat = categoryMap.get(it.categoryId);
        return {
          id: it.id,
          name: it.name,
          emoji: it.emoji,
          bgColor: it.bgColor,
          description: it.description,
          categoryId: it.categoryId,
          categoryName: cat?.name ?? "Uncategorized",
          categoryIcon: cat?.icon ?? "🍽️",
          isActive: it.isActive,
          isOutOfStock: !isMenuItemAvailable(it),
          basePrice: it.price,
          sizes: it.sizes
            .filter((s) => !!s.id)
            .map((s) => ({
              id: s.id as string,
              name: s.name,
              priceDelta: s.priceDelta,
            })),
        };
      });
  }, [allItems, categoryMap, dealCategoryIds, draft.id]);

  async function handleSave() {
    if (!canSave) return;
    setError(null);
    setConflictMsg(null);
    const pricedDraft: Item = {
      ...draft,
      upgradeOptions: draft.upgradeOptions.map((option) => {
        const optionPreview = dealOptionPreview(option);
        if (!optionPreview.complete) return option;
        return {
          ...option,
          extraCharge: optionPreview.customerPays,
          savingsLabel: optionPreview.save,
        };
      }),
    };
    const result = await onSave(pricedDraft, heroPending);
    if (!result.ok) {
      if (result.conflict) setConflictMsg(result.error);
      else setError(result.error);
    }
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    void (onHardDelete ? onHardDelete() : onDelete());
  }

  function handleCancel() {
    if (
      dirty &&
      !window.confirm("Discard unsaved deal changes? Your changes will not be saved.")
    ) {
      return;
    }
    onCancel();
  }

  function handleVisibilityToggle() {
    setDraft((d) => ({ ...d, isActive: !d.isActive }));
  }

  function updateUpgrade(index: number, next: AdminUpgradeOptionInput) {
    setDraft((d) => ({
      ...d,
      upgradeOptions: d.upgradeOptions.map((u, i) => (i === index ? next : u)),
    }));
  }

  function appendLinkedItem(
    upgradeIndex: number,
    menuItemId: string,
    sizeId: string | null
  ) {
    const it = itemMap.get(menuItemId);
    const sz = sizeId ? sizeIndex.get(sizeId) : null;
    setDraft((d) => {
      const upgrade = d.upgradeOptions[upgradeIndex];
      if (!upgrade) return d;
      return {
        ...d,
        upgradeOptions: d.upgradeOptions.map((u, i) =>
          i === upgradeIndex
            ? {
                ...u,
                linkedItems:
                  replaceTarget && replaceTarget.upgradeIndex === upgradeIndex
                    ? u.linkedItems.map((link, linkIndex) =>
                        linkIndex === replaceTarget.linkIndex
                          ? {
                              ...link,
                              linkedMenuItemId: menuItemId,
                              linkedSizeId: sizeId,
                              itemNameSnapshot: it?.name ?? null,
                              sizeNameSnapshot: sz?.name ?? null,
                            }
                          : link
                      )
                    : [
                        ...u.linkedItems,
                        {
                          linkedMenuItemId: menuItemId,
                          linkedSizeId: sizeId,
                          itemNameSnapshot: it?.name ?? null,
                          sizeNameSnapshot: sz?.name ?? null,
                          sortOrder: u.linkedItems.length,
                        } as AdminUpgradeItemLinkInput & {
                          sizeNameSnapshot: string | null;
                        },
                      ],
              }
            : u
        ),
      };
    });
    setReplaceTarget(null);
  }

  function applyBaseItem(menuItemId: string, sizeId: string | null = null) {
    const base = itemMap.get(menuItemId);
    if (!base || dealCategoryIds.has(base.categoryId) || base.id === draft.id) return;
    const selectedSize = sizeId
      ? (base.sizes.find((size) => size.id === sizeId) ?? null)
      : null;
    const baseSizeForDeal =
      selectedSize ?? base.sizes.find((size) => !!size.id) ?? null;
    setDraft((d) => {
      const shouldSeedLinkedOption =
        mode === "create" &&
        !d.upgradeOptions.some((option) => option.linkedItems.length > 0);
      const baseLink = buildBaseLink(base, baseSizeForDeal?.id ?? null);
      const linkedPrice =
        base.price +
        (base.sizes.find((size) => size.id === baseLink.linkedSizeId)
          ?.priceDelta ?? 0);
      const save = +(linkedPrice * defaultDiscountPct / 100).toFixed(2);
      const customerPays = +(linkedPrice - save).toFixed(2);
      const seedOption = d.upgradeOptions[0] ?? {
        id: newTempId("upgrade"),
        customTitle: null,
        extraCharge: customerPays,
        savingsLabel: save,
        discountPct: defaultDiscountPct,
        sortOrder: 0,
        linkedItems: [],
      };
      return {
        ...d,
        dealBaseMenuItemId: base.id,
        dealBaseSizeId: baseSizeForDeal?.id ?? null,
        dealBaseSizeNameSnapshot: baseSizeForDeal?.name ?? null,
        name: base.name,
        description: base.description,
        price: base.price,
        emoji: base.emoji,
        bgColor: base.bgColor,
        imageUrl: base.imageUrl,
        imageAlt: base.imageAlt,
        imageFit: base.imageFit,
        cardImageUrl: base.cardImageUrl,
        cardImageAlt: base.cardImageAlt,
        isOutOfStock: false,
        upgradeOptions: shouldSeedLinkedOption
          ? [
              {
                ...seedOption,
                extraCharge: customerPays,
                savingsLabel: save,
                discountPct: seedOption.discountPct ?? defaultDiscountPct,
                linkedItems: [baseLink],
              },
            ]
          : d.upgradeOptions,
      };
    });
  }

  function parseOptionalWholeNumber(value: string): number | null {
    if (value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isInteger(parsed) ? Math.max(0, parsed) : null;
  }

  function updateDealLimitMode(mode: "UNLIMITED" | "LIMITED") {
    setDraft((current) => ({
      ...current,
      dealLimitMode: mode,
      dealLimitQty:
        mode === "LIMITED" ? current.dealLimitQty ?? 0 : current.dealLimitQty ?? null,
      dealLimitLowThreshold: current.dealLimitLowThreshold ?? null,
    }));
  }

  const startDateValue = toDealScheduleDateInputValue(draft.dealStartsAt ?? null);
  const startTimeValue = draft.dealStartsAt
    ? toDealScheduleTimeInputValue(draft.dealStartsAt)
    : DEFAULT_DEAL_START_TIME;
  const expirationDateValue = toDealScheduleDateInputValue(
    draft.dealExpiresAt,
    { legacyEndMidnightAsPreviousDay: true },
  );
  const expirationTimeValue = toDealScheduleTimeInputValue(
    draft.dealExpiresAt,
    { legacyEndMidnightAsPreviousDay: true },
  );
  const todayPresetAvailable = isOnlyTodayPresetAvailable();

  function setDraftDealStart(dateValue: string, timeValue = startTimeValue) {
    setDraft((current) => ({
      ...current,
      dealStartsAt: dateValue
        ? dealScheduleIsoForLocalDateTime(
            dateValue,
            timeValue || DEFAULT_DEAL_START_TIME,
          )
        : null,
    }));
  }

  function setDraftDealExpiration(dateValue: string, timeValue = expirationTimeValue) {
    setDraft((current) => ({
      ...current,
      dealExpiresAt: dateValue
        ? dealScheduleIsoForLocalDateTime(dateValue, timeValue)
        : null,
    }));
  }

  function setDraftDealExpirationPreset(daysFromToday: number) {
    const preset =
      daysFromToday === 0
        ? dealSchedulePresetToday()
        : dealSchedulePresetTomorrow();
    if (!preset) return;
    setDraft((current) => ({
      ...current,
      dealStartsAt: preset.startsAt,
      dealExpiresAt: preset.expiresAt,
    }));
  }

  function setDraftDealStartsNow() {
    const now = new Date();
    const currentEnd = draft.dealExpiresAt ? new Date(draft.dealExpiresAt) : null;
    setDraft((current) => ({
      ...current,
      dealStartsAt: defaultDealStartIso(now),
      dealExpiresAt:
        currentEnd && currentEnd.getTime() > now.getTime()
          ? current.dealExpiresAt
          : defaultDealEndIso(now),
    }));
  }

  return (
    <>
    <ModalShell
      ariaLabel={`${mode === "edit" ? "Edit" : "Create"} deal`}
      maxWidthClassName="max-w-[1600px]"
      bodyClassName="flex-1 min-h-0 overflow-y-auto xl:flex xl:overflow-hidden"
      onClose={handleCancel}
      titleNode={
        <h2
          className="flex items-center gap-2.5 truncate"
          style={{ fontFamily: "Archivo Black", letterSpacing: "-0.02em" }}
        >
          {(() => {
            const activeCategory = categoryMap.get(draft.categoryId);
            if (!activeCategory) return null;
            return (
              <>
                <span className="inline-flex shrink-0 items-center gap-1.5 text-base font-black text-stone-500 tracking-normal">
                  <span className="text-lg leading-none">
                    {activeCategory.icon}
                  </span>
                  {activeCategory.name}
                </span>
                <span className="shrink-0 text-stone-300 text-xl leading-none">
                  ›
                </span>
              </>
            );
          })()}
          <span className="inline-flex min-w-0 items-center gap-2 text-2xl text-stone-900">
            <span className="shrink-0 text-2xl leading-none">
              {draft.emoji || "✨"}
            </span>
            <span className="truncate">{draft.name || "Untitled deal"}</span>
          </span>
        </h2>
      }
      body={(
        <div className="flex min-h-full flex-col gap-5 px-8 pb-6 pt-0 xl:min-h-0 xl:flex-1 xl:flex-row xl:overflow-hidden">
          <div
            className="min-w-0 xl:max-h-full xl:flex-[1_1_0] xl:self-start xl:overflow-x-hidden xl:overflow-y-auto xl:overscroll-contain xl:pr-3"
            data-testid="deal-editor-detail-scroll"
            style={{ scrollbarGutter: "stable" } as React.CSSProperties}
          >
            <DealSectionJumpNav
              sections={DEAL_FORM_SECTIONS}
              selectedSectionId={selectedSectionId}
              invalidSectionIds={invalidSectionIds}
              onJump={scrollToSection}
              allSectionsCollapsed={allCollapsibleSectionsCollapsed}
              onCollapseAll={collapseAllSections}
              onExpandAll={expandAllSections}
              previewVisible={previewVisible}
              onTogglePreview={() => setPreviewVisible((visible) => !visible)}
            />

            {(error || conflictMsg) && (
              <div
                role="alert"
                className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
                style={{
                  background: conflictMsg ? "#FEF3C7" : "#FFE3E0",
                  color: conflictMsg ? "#92400E" : BRAND.redDark,
                }}
              >
                {conflictMsg ?? error}
              </div>
            )}

            <DealEditorSection
              id="availability"
              title="Availability"
              summary={availabilitySummary}
              selected={selectedSectionId === "availability"}
              hasError={invalidSectionIds.has("availability")}
              collapsed={collapsedSections.has("availability")}
              onToggle={() => toggleSection("availability")}
              sectionRef={(node) => setSectionRef("availability", node)}
            >
              <VisibilityRow
                isActive={draft.isActive}
                isOutOfStock={draft.isOutOfStock}
                onIsActiveChange={(v) => setDraft({ ...draft, isActive: v })}
                onOutOfStockChange={(v) =>
                  setDraft({ ...draft, isOutOfStock: v })
                }
                omitLiveToggle
                omitStockToggle
                omitHelpText
                canWrite={canWriteMenu}
                expirationSlot={
                  <div className="grid w-full gap-4 text-sm text-stone-700">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(11rem,1fr)_minmax(11rem,1fr)_minmax(9rem,0.65fr)_minmax(9rem,0.65fr)]">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-black tracking-widest uppercase text-stone-700">
                          Starts on
                        </span>
                        <input
                          type="date"
                          value={startDateValue}
                          disabled={!canWriteMenu}
                          onChange={(e) =>
                            setDraftDealStart(e.target.value, startTimeValue)
                          }
                          className="w-full min-w-[11rem] px-3 py-2 rounded-xl border border-stone-200 bg-white font-mono text-sm focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                          style={
                            { "--tw-ring-color": BRAND.yellow } as React.CSSProperties
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-black tracking-widest uppercase text-stone-700">
                          Ends on
                        </span>
                        <input
                          type="date"
                          value={expirationDateValue}
                          disabled={!canWriteMenu}
                          onChange={(e) =>
                            setDraftDealExpiration(
                              e.target.value,
                              expirationTimeValue,
                            )
                          }
                          className="w-full min-w-[11rem] px-3 py-2 rounded-xl border border-stone-200 bg-white font-mono text-sm focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                          style={
                            { "--tw-ring-color": BRAND.yellow } as React.CSSProperties
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-black tracking-widest uppercase text-stone-700">
                          Start
                        </span>
                        <input
                          type="time"
                          value={startTimeValue}
                          disabled={!canWriteMenu || !startDateValue}
                          onChange={(e) =>
                            setDraftDealStart(startDateValue, e.target.value)
                          }
                          className="w-full min-w-[9rem] px-3 py-2 rounded-xl border border-stone-200 bg-white font-mono text-sm focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                          style={
                            { "--tw-ring-color": BRAND.yellow } as React.CSSProperties
                          }
                        />
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] font-black tracking-widest uppercase text-stone-700">
                          End
                        </span>
                        <input
                          type="time"
                          value={expirationTimeValue}
                          disabled={!canWriteMenu || !expirationDateValue}
                          onChange={(e) =>
                            setDraftDealExpiration(
                              expirationDateValue,
                              e.target.value,
                            )
                          }
                          className="w-full min-w-[9rem] px-3 py-2 rounded-xl border border-stone-200 bg-white font-mono text-sm focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                          style={
                            { "--tw-ring-color": BRAND.yellow } as React.CSSProperties
                          }
                        />
                      </label>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-[11px] font-bold text-stone-500">
                        Fallback cutoff is {DEFAULT_DEAL_EXPIRATION_TIME_LABEL}{" "}
                        local outlet time until store close is configured.
                      </p>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          disabled={!canWriteMenu}
                          onClick={setDraftDealStartsNow}
                          className="rounded-full border border-stone-200 bg-white px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Starts now
                        </button>
                        <button
                          type="button"
                          disabled={!canWriteMenu || !todayPresetAvailable}
                          title={
                            todayPresetAvailable
                              ? undefined
                              : `Today already passed the ${DEFAULT_DEAL_EXPIRATION_TIME_LABEL} cutoff.`
                          }
                          onClick={() => setDraftDealExpirationPreset(0)}
                          className="rounded-full border border-stone-200 bg-white px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Only today
                        </button>
                        <button
                          type="button"
                          disabled={!canWriteMenu}
                          onClick={() => setDraftDealExpirationPreset(1)}
                          className="rounded-full border border-stone-200 bg-white px-3.5 py-2 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Only tomorrow
                        </button>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-stone-200 bg-white/80 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-widest text-stone-700">
                            Deal limit
                          </div>
                          <p className="mt-1 text-[11px] font-bold text-stone-500">
                            Optional cap for how many times this deal can be sold.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            disabled={!canWriteMenu}
                            onClick={() => updateDealLimitMode("UNLIMITED")}
                            aria-pressed={dealLimitMode === "UNLIMITED"}
                            className={`rounded-full border px-3.5 py-2 text-[10px] font-black uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-50 ${
                              dealLimitMode === "UNLIMITED"
                                ? "border-stone-900 bg-stone-900 text-yellow-300"
                                : "border-stone-200 bg-white text-stone-700"
                            }`}
                          >
                            Unlimited
                          </button>
                          <span
                            aria-hidden="true"
                            className="self-center text-[10px] font-black uppercase tracking-widest text-stone-400"
                          >
                            or
                          </span>
                          <button
                            type="button"
                            disabled={!canWriteMenu}
                            onClick={() => updateDealLimitMode("LIMITED")}
                            aria-pressed={dealLimitMode === "LIMITED"}
                            className={`rounded-full border px-3.5 py-2 text-[10px] font-black uppercase tracking-widest disabled:cursor-not-allowed disabled:opacity-50 ${
                              dealLimitMode === "LIMITED"
                                ? "border-stone-900 bg-stone-900 text-yellow-300"
                                : "border-stone-200 bg-white text-stone-700"
                            }`}
                          >
                            Limit number sold
                          </button>
                        </div>
                      </div>
                      {dealLimitMode === "LIMITED" && (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-black tracking-widest uppercase text-stone-700">
                              Quantity available
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={DEAL_LIMIT_MAX_QTY}
                              step={1}
                              value={dealLimitQty ?? ""}
                              disabled={!canWriteMenu}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  dealLimitQty: parseOptionalWholeNumber(
                                    event.target.value,
                                  ),
                                }))
                              }
                              className="w-full min-w-[9rem] rounded-xl border border-stone-200 bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                              style={
                                { "--tw-ring-color": BRAND.yellow } as React.CSSProperties
                              }
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className="text-[10px] font-black tracking-widest uppercase text-stone-700">
                              Low alert
                            </span>
                            <input
                              type="number"
                              min={0}
                              max={DEAL_LIMIT_MAX_QTY}
                              step={1}
                              value={dealLimitLowThreshold ?? ""}
                              disabled={!canWriteMenu}
                              onChange={(event) =>
                                setDraft((current) => ({
                                  ...current,
                                  dealLimitLowThreshold:
                                    parseOptionalWholeNumber(event.target.value),
                                }))
                              }
                              className="w-full min-w-[9rem] rounded-xl border border-stone-200 bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-stone-100 disabled:text-stone-400"
                              placeholder="Optional"
                              style={
                                { "--tw-ring-color": BRAND.yellow } as React.CSSProperties
                              }
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                }
              />

              {!expirationValid && (
                <p className="mt-2 text-xs font-bold text-red-600">
                  {scheduleValidation.message}
                </p>
              )}
              {!dealLimitValid && (
                <p className="mt-2 text-xs font-bold text-red-600">
                  Deal limit quantity and low alert must be whole numbers from 0 to {DEAL_LIMIT_MAX_QTY}.
                </p>
              )}
            </DealEditorSection>

            <DealEditorSection
              id="base"
              title="Base item"
              summary={baseSummary}
              selected={selectedSectionId === "base"}
              hasError={invalidSectionIds.has("base")}
              collapsed={collapsedSections.has("base")}
              onToggle={() => toggleSection("base")}
              sectionRef={(node) => setSectionRef("base", node)}
            >
              <div className="mb-3">
                <SectionTitle hint="The real menu item this deal sells. Stock and availability follow this item; the deal row is only the pricing wrapper.">
                  Base item
                </SectionTitle>
              </div>
              <div
                className={`rounded-2xl border p-4 flex items-center gap-4 ${
                  baseRepair?.blocksSave ? "border-red-300" : "border-stone-200"
                }`}
                style={
                  baseRepair?.blocksSave
                    ? { background: "#FEF2F2" }
                    : { background: BRAND.cream }
                }
              >
                <div
                  className="w-14 h-14 rounded-2xl border border-stone-200 flex items-center justify-center text-3xl flex-shrink-0"
                  style={{ background: baseItem?.bgColor ?? "#ffffff" }}
                >
                  {baseItem?.emoji ?? "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-black tracking-widest uppercase text-stone-500">
                    Deal base
                  </div>
                  <div
                    className="text-xl text-stone-900 truncate"
                    style={{
                      fontFamily: "Archivo Black",
                      letterSpacing: "-0.02em",
                    }}
                  >
                    {baseItem?.name ?? "No base item selected"}
                  </div>
                  <div className="mt-1 text-xs text-stone-500">
                    {baseItem
                      ? `${categoryMap.get(baseItem.categoryId)?.name ?? "Menu"}${
                          baseSizeName
                            ? ` · ${baseSizeName}`
                            : baseItem.sizes.length > 0
                              ? " · Base size not selected"
                              : ""
                        } · $${(basePriceWithSize ?? baseItem.price).toFixed(2)}`
                      : "Choose the real non-deal menu item behind this deal."}
                  </div>
                  {baseRepair && (
                    <div
                      className={`mt-2 text-xs font-bold ${
                        baseRepair.blocksSave ? "text-red-700" : "text-amber-700"
                      }`}
                    >
                      {baseRepair.message}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPickerForBase(true)}
                  className="px-4 py-2.5 rounded-full border border-stone-300 bg-white text-[11px] font-black tracking-widest uppercase hover:border-stone-900"
                >
                  {baseItem ? "Change base" : "Set base"}
                </button>
              </div>
            </DealEditorSection>

            <DealEditorSection
              id="options"
              title="Deal options"
              summary={optionSummary}
              collapsedDetails={optionSummaryLines}
              selected={selectedSectionId === "options"}
              hasError={invalidSectionIds.has("options")}
              collapsed={collapsedSections.has("options")}
              onToggle={() => toggleSection("options")}
              sectionRef={(node) => setSectionRef("options", node)}
            >
              <div className="mb-3">
                <SectionTitle hint="A deal option is one complete bundle choice. Pick the required menu items that ship together; the kiosk auto-titles the option from those items.">
                  Deal option
                </SectionTitle>
              </div>

              {structuralRepairMessages.length > 0 && (
                <div
                  role="alert"
                  className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                >
                  <div className="font-black tracking-widest uppercase text-[11px] mb-1">
                    Repair required before saving
                  </div>
                  <ul className="list-disc pl-5 space-y-1">
                    {structuralRepairMessages.map((message, index) => (
                      <li key={`${message}-${index}`}>{message}</li>
                    ))}
                  </ul>
                </div>
              )}

              {draft.upgradeOptions.map((option, i) => (
                <UpgradeOptionEditor
                  key={i}
                  optionNumber={i + 1}
                  option={option}
                  onChange={(next) => updateUpgrade(i, next)}
                  onRemove={
                    draft.upgradeOptions.length > 1
                      ? () =>
                          setDraft({
                            ...draft,
                            upgradeOptions: draft.upgradeOptions.filter(
                              (_, x) => x !== i
                            ),
                          })
                      : undefined
                  }
                  links={option.linkedItems.map((link) => ({
                    ...link,
                    preview: resolveLinkPreview(link),
                  }))}
                  defaultDiscountPct={defaultDiscountPct}
                  requireCompleteLinkedItems
                  onAddLinkedItem={() => {
                    setReplaceTarget(null);
                    setPickerForUpgrade(i);
                  }}
                  onReplaceLinkedItem={(linkIndex) => {
                    setReplaceTarget({ upgradeIndex: i, linkIndex });
                    setPickerForUpgrade(i);
                  }}
                  onRemoveLinkedItem={(_id, idx) => {
                    updateUpgrade(i, {
                      ...option,
                      linkedItems: option.linkedItems.filter(
                        (_, x) => x !== idx
                      ),
                    });
                  }}
                />
              ))}
            </DealEditorSection>
          </div>

          {previewVisible && (
            <aside
              className="self-start xl:w-[380px] xl:shrink-0 2xl:w-[420px]"
              aria-label="Live kiosk preview"
            >
              <div className="text-[11px] font-black tracking-widest uppercase text-stone-700 mb-2.5">
                {previewHeading}
              </div>
              {effectivelyLive ? (
                <div className="space-y-3">
                  {pendingVisibilityMessage && (
                    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-snug text-amber-900">
                      {pendingVisibilityMessage}
                    </div>
                  )}
                  <KioskDealPreview
                    upgradeHeadline={previewModel.headline}
                    upgradeCustomerPays={previewModel.customerPays}
                    upgradeSave={previewModel.save}
                    includedItems={previewModel.included}
                  />
                </div>
              ) : (
                <div
                  className={[
                    "rounded-3xl border-2 p-5 shadow-sm",
                    visibilityDraftChanged
                      ? "border-amber-300 bg-amber-50"
                      : "border-red-200 bg-red-50",
                  ].join(" ")}
                >
                  <div
                    className={[
                      "text-xs font-black tracking-widest",
                      visibilityDraftChanged ? "text-amber-900" : "text-red-800",
                    ].join(" ")}
                  >
                    {visibilityDraftChanged ? "UNSAVED VISIBILITY CHANGE" : "HIDDEN FROM KIOSK"}
                  </div>
                  <p
                    className={[
                      "mt-2 text-sm font-bold leading-snug",
                      visibilityDraftChanged ? "text-amber-950/80" : "text-red-800/80",
                    ].join(" ")}
                  >
                    {previewHiddenReason}
                  </p>
                </div>
              )}
            </aside>
          )}
        </div>
      )}
      footer={
        <>
          {canWriteMenu ? (
            <div className="min-w-0">
              <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-red-700">
                Danger zone
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={handleVisibilityToggle}
                  disabled={saving || busyDeleting}
                  className="inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-50"
                  style={{
                    color: draft.isActive ? BRAND.red : "#047857",
                    background: "#fff",
                    borderColor: draft.isActive ? "#F5B8B2" : "#A7F3D0",
                  }}
                >
                  {draft.isActive ? "Hide deal" : "Show deal"}
                </button>
                {mode === "edit" && (
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={busyDeleting}
                    className="inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-50"
                    style={{
                      color: confirmingDelete ? "white" : BRAND.red,
                      background: confirmingDelete ? BRAND.red : "#fff",
                      borderColor: confirmingDelete ? BRAND.red : "#F5B8B2",
                    }}
                  >
                    {confirmingDelete
                      ? "Click again to delete"
                      : onHardDelete
                        ? "Hard delete deal"
                        : "Delete deal"}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <span aria-hidden />
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-stone-500 font-mono">
              <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded text-[11px]">
                ⌘S
              </kbd>{" "}
              save ·{" "}
              <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded text-[11px]">
                Esc
              </kbd>{" "}
              cancel
            </span>
            <button
              type="button"
              onClick={handleCancel}
              className="px-7 py-3.5 rounded-full text-xs font-black tracking-widest uppercase text-stone-900 border border-stone-300 hover:bg-stone-50"
            >
              Cancel
            </button>
            {canWriteMenu && (
              <button
                type="button"
                onClick={handleSave}
                disabled={!canSave}
                className="px-7 py-3.5 rounded-full text-xs font-black tracking-widest uppercase text-white disabled:opacity-50"
                style={{
                  background: BRAND.red,
                  boxShadow: "0 4px 12px rgba(215,38,30,0.25)",
                }}
              >
                {saving ? "Saving…" : "Save deal"}
              </button>
            )}
          </div>
        </>
      }
    />
    {pickerForBase && (
      <LinkedItemPicker
        isOpen
        onClose={() => setPickerForBase(false)}
        items={pickerItems}
        alreadyLinkedIds={draft.dealBaseMenuItemId ? [draft.dealBaseMenuItemId] : []}
        allowNoSizeSelection={false}
        onSelect={(menuItemId, sizeId) => {
          applyBaseItem(menuItemId, sizeId);
        }}
      />
    )}
    {/* Linked-item picker, sibling overlay above the modal shell. */}
    {pickerForUpgrade != null && (
      <LinkedItemPicker
        isOpen
        onClose={() => {
          setPickerForUpgrade(null);
          setReplaceTarget(null);
        }}
        items={pickerItems}
        alreadyLinkedIds={
          draft.upgradeOptions[pickerForUpgrade]?.linkedItems
            .map((l, linkIndex) =>
              replaceTarget &&
              replaceTarget.upgradeIndex === pickerForUpgrade &&
              replaceTarget.linkIndex === linkIndex
                ? null
                : l.linkedMenuItemId
            )
            .filter((id): id is string => id != null) ?? []
        }
        onSelect={(menuItemId, sizeId) => {
          appendLinkedItem(pickerForUpgrade, menuItemId, sizeId);
        }}
      />
    )}
    </>
  );
}

function DealSectionJumpNav({
  sections,
  selectedSectionId,
  invalidSectionIds,
  onJump,
  allSectionsCollapsed,
  onCollapseAll,
  onExpandAll,
  previewVisible,
  onTogglePreview,
}: {
  sections: typeof DEAL_FORM_SECTIONS;
  selectedSectionId: DealFormSectionId | null;
  invalidSectionIds: Set<DealFormSectionId>;
  onJump: (id: DealFormSectionId) => void;
  allSectionsCollapsed: boolean;
  onCollapseAll: () => void;
  onExpandAll: () => void;
  previewVisible: boolean;
  onTogglePreview: () => void;
}) {
  const sectionBulkLabel = allSectionsCollapsed ? "Expand all" : "Collapse all";

  return (
    <div className="sticky top-0 z-20 mb-2 border-b border-stone-100 bg-white/95 py-2 backdrop-blur">
      <div className="flex items-center gap-2">
        <nav
          className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-0.5"
          aria-label="Deal editor sections"
          data-testid="deal-editor-section-nav"
        >
          {sections.map((section) => {
            const selected = section.id === selectedSectionId;
            const invalid = invalidSectionIds.has(section.id);
            return (
              <button
                key={section.id}
                type="button"
                onClick={() => onJump(section.id)}
                aria-current={selected ? "true" : undefined}
                className="relative shrink-0 rounded-full border px-3.5 py-1.5 text-[11px] font-black uppercase tracking-widest transition-colors focus-visible:outline-none focus-visible:ring-2"
                style={{
                  background: selected ? BRAND.black : "white",
                  borderColor: selected ? BRAND.black : "#E7E5E4",
                  color: selected ? BRAND.yellow : "#44403C",
                  "--tw-ring-color": BRAND.yellow,
                } as React.CSSProperties}
              >
                {section.label}
                {invalid && (
                  <span
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full"
                    style={{ background: BRAND.red }}
                    aria-label="Section has an error"
                  />
                )}
              </button>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={allSectionsCollapsed ? onExpandAll : onCollapseAll}
          aria-label={sectionBulkLabel}
          title={sectionBulkLabel}
          className={`inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border border-stone-200 bg-white text-[11px] font-black uppercase tracking-widest text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2 ${
            previewVisible ? "w-9 px-0" : "px-3"
          }`}
          style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
        >
          {allSectionsCollapsed ? (
            <ChevronsDown size={14} strokeWidth={2.5} />
          ) : (
            <ChevronsUp size={14} strokeWidth={2.5} />
          )}
          {!previewVisible && <span>{sectionBulkLabel}</span>}
        </button>
        <button
          type="button"
          onClick={onTogglePreview}
          aria-pressed={previewVisible}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[11px] font-black uppercase tracking-widest text-stone-700 transition-colors hover:border-stone-300 hover:bg-stone-50 focus-visible:outline-none focus-visible:ring-2"
          style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
        >
          {previewVisible ? <EyeOff size={14} strokeWidth={2.5} /> : <Eye size={14} strokeWidth={2.5} />}
          <span>{previewVisible ? "Hide preview" : "Show preview"}</span>
        </button>
      </div>
    </div>
  );
}

function DealEditorSection({
  id,
  title,
  summary,
  collapsedDetails,
  selected,
  hasError,
  collapsed,
  onToggle,
  sectionRef,
  children,
}: {
  id: DealFormSectionId;
  title: string;
  summary?: string;
  collapsedDetails?: string[];
  selected?: boolean;
  hasError?: boolean;
  collapsed: boolean;
  onToggle: () => void;
  sectionRef: (node: HTMLElement | null) => void;
  children: React.ReactNode;
}) {
  return (
    <section
      ref={sectionRef}
      id={`deal-editor-${id}`}
      data-editor-section={id}
      data-testid={`deal-editor-section-${id}`}
      className={`group scroll-mt-24 border-l-4 border-t border-stone-150 py-5 pl-4 transition-colors duration-200 first:border-t-0 first:pt-0 ${
        selected
          ? "border-l-yellow-400"
          : "border-l-transparent hover:border-l-yellow-200"
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        className="mb-3 flex w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
        aria-expanded={!collapsed}
        aria-controls={`deal-editor-${id}-body`}
      >
        <span className="min-w-0">
          <span
            className={`block text-[11px] font-black uppercase tracking-widest ${
              hasError ? "text-red-700" : "text-stone-700"
            }`}
          >
            {title}
          </span>
          {summary && collapsed && (
            <span className="mt-1 block truncate text-xs font-bold text-stone-500">
              {summary}
            </span>
          )}
          {collapsed && collapsedDetails && collapsedDetails.length > 0 && (
            <span className="mt-2 block space-y-1">
              {collapsedDetails.map((detail, index) => (
                <span
                  key={`${detail}-${index}`}
                  className="block truncate text-xs font-bold text-stone-600"
                >
                  {detail}
                </span>
              ))}
            </span>
          )}
        </span>
        <span
          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-xl font-black leading-none text-stone-700 shadow-sm transition-transform ${
            collapsed ? "-rotate-90" : ""
          }`}
          aria-hidden
        >
          ▾
        </span>
      </button>
      <div
        id={`deal-editor-${id}-body`}
        data-testid={`deal-editor-section-body-${id}`}
        hidden={collapsed}
      >
        {children}
      </div>
    </section>
  );
}

function SectionTitle({
  children,
  hint,
}: {
  children: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="text-[11px] font-black tracking-widest uppercase text-stone-700 mb-3 inline-flex items-center gap-1.5">
      {children}
      {hint && (
        <span
          tabIndex={0}
          aria-label={hint}
          title={hint}
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-stone-200 text-stone-600 text-[10px] font-black cursor-help hover:bg-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400"
        >
          ?
        </span>
      )}
    </div>
  );
}
