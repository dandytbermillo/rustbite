"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { lockBodyScroll } from "@/lib/body-scroll-lock";
import {
  isAddonOptionAvailable,
  isOptionLowStock,
  optionStockLabel,
} from "@/lib/option-stock";
import WorkspaceOptionStockControls, {
  normalizeWorkspaceOptionStock,
  type WorkspaceOptionStockPatch,
} from "./WorkspaceOptionStockControls";
import type {
  SharedModifierGroup,
  SharedModifierOption,
  SharedModifierSelectionMode,
  WorkspaceAddOnManagerFocus,
} from "@/components/admin/menu-editor";

type GroupFields = {
  name: string;
  description: string | null;
  selectionMode: SharedModifierSelectionMode;
  minSelect: number;
  maxSelect: number | null;
};

type OptionFields = {
  name: string;
  priceDelta: number;
};

type OptionEditorFields = OptionFields &
  WorkspaceOptionStockPatch & {
    id: string;
    isActive: boolean;
  };

type SaveGroupDraftInput = {
  group: GroupFields;
  options: OptionEditorFields[];
};

type CreateFirstOptionFields = OptionFields & WorkspaceOptionStockPatch;

type CreateGroupWithFirstOptionInput = {
  group: GroupFields;
  firstOption: CreateFirstOptionFields;
};

type Props = {
  groups: SharedModifierGroup[];
  focusedGroupId?: string | null;
  focusContext?: WorkspaceAddOnManagerFocus | null;
  loading: boolean;
  error: string | null;
  busyKey: string | null;
  onClose: () => void;
  onRefresh: () => void | Promise<void>;
  onCreateGroupWithFirstOption: (
    input: CreateGroupWithFirstOptionInput
  ) =>
    | SharedModifierGroup
    | null
    | void
    | Promise<SharedModifierGroup | null | void>;
  onUpdateGroup: (
    group: SharedModifierGroup,
    fields: Partial<GroupFields & { isActive: boolean }>
  ) => void | Promise<void>;
  onDeactivateGroup: (group: SharedModifierGroup) => void | Promise<void>;
  onHardDeleteGroup: (group: SharedModifierGroup) => void | Promise<void>;
  onSaveGroupDraft: (
    group: SharedModifierGroup,
    input: SaveGroupDraftInput
  ) => void | Promise<void>;
  onCreateOption: (
    group: SharedModifierGroup,
    input: OptionFields
  ) => void | Promise<void>;
  onHardDeleteOption: (
    group: SharedModifierGroup,
    option: SharedModifierOption
  ) => void | Promise<void>;
};

const INPUT_CLS =
  "w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-bold text-stone-900 outline-none focus:border-stone-900 focus:ring-2";

const EMPTY_GROUP_DRAFT: GroupFields = {
  name: "",
  description: null,
  selectionMode: "OPTIONAL_MULTI",
  minSelect: 0,
  maxSelect: null,
};

function optionFields(option: SharedModifierOption): OptionEditorFields {
  const stock = normalizeWorkspaceOptionStock({
    stockMode: option.stockMode ?? "MANUAL",
    isOutOfStock: option.isOutOfStock ?? false,
    stockQty: option.stockQty ?? null,
    lowStockThreshold: option.lowStockThreshold ?? null,
  });

  return {
    id: option.id,
    name: option.name,
    priceDelta: option.priceDelta,
    isActive: option.isActive,
    ...stock,
    stockQty:
      stock.stockMode === "MANUAL" ? option.stockQty ?? null : stock.stockQty,
    lowStockThreshold:
      stock.stockMode === "MANUAL"
        ? option.lowStockThreshold ?? null
        : stock.lowStockThreshold,
  };
}

function optionFieldsEqual(a: OptionEditorFields, b: OptionEditorFields) {
  return (
    a.name.trim() === b.name.trim() &&
    Math.abs(roundMoney(a.priceDelta) - roundMoney(b.priceDelta)) < 0.005 &&
    a.isActive === b.isActive &&
    a.stockMode === b.stockMode &&
    a.isOutOfStock === b.isOutOfStock &&
    a.stockQty === b.stockQty &&
    a.lowStockThreshold === b.lowStockThreshold
  );
}

function optionFieldsValid(option: OptionEditorFields) {
  return (
    option.name.trim().length > 0 &&
    Number.isFinite(option.priceDelta) &&
    option.priceDelta >= 0 &&
    (option.stockMode === "MANUAL" ||
      (Number.isInteger(option.stockQty ?? 0) &&
        (option.stockQty ?? 0) >= 0 &&
        (option.lowStockThreshold == null ||
          (Number.isInteger(option.lowStockThreshold) &&
            option.lowStockThreshold >= 0))))
  );
}

type OptionStockTone = "green" | "amber" | "red" | "stone";

function optionStockClasses(tone: OptionStockTone) {
  if (tone === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (tone === "amber") return "border-amber-200 bg-amber-50 text-amber-900";
  if (tone === "red") return "border-red-200 bg-red-50 text-red-800";
  return "border-stone-200 bg-stone-50 text-stone-600";
}

function ModifierOptionStockBadge({
  option,
}: {
  option: Pick<
    SharedModifierOption,
    "stockMode" | "isOutOfStock" | "stockQty" | "lowStockThreshold"
  >;
}) {
  const stock = {
    stockMode: option.stockMode ?? "MANUAL",
    isOutOfStock: option.isOutOfStock ?? false,
    stockQty:
      option.stockMode === "QUANTITY" ? option.stockQty ?? 0 : null,
    lowStockThreshold:
      option.stockMode === "QUANTITY" ? option.lowStockThreshold ?? null : null,
  };
  const available = isAddonOptionAvailable(stock);
  const low = isOptionLowStock(stock);
  const label = low ? `Low · ${optionStockLabel(stock)}` : optionStockLabel(stock);
  const tone: OptionStockTone = available
    ? low
      ? "amber"
      : stock.stockMode === "MANUAL"
        ? "green"
        : "stone"
    : "red";

  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${optionStockClasses(
        tone,
      )}`}
      title={`${stock.stockMode === "QUANTITY" ? "Quantity" : "Manual"} stock: ${label}`}
    >
      {label}
    </span>
  );
}

function activeOptionsForGroup(group: SharedModifierGroup) {
  return group.options.filter((option) => option.isActive);
}

function availableActiveOptionsForGroup(group: SharedModifierGroup) {
  return activeOptionsForGroup(group).filter((option) =>
    isAddonOptionAvailable({
      stockMode: option.stockMode,
      isOutOfStock: option.isOutOfStock,
      stockQty: option.stockQty,
      lowStockThreshold: option.lowStockThreshold,
    }),
  );
}

function groupStockSummary(group: SharedModifierGroup): {
  kind: "inactive" | "empty" | "out" | "partial" | "live";
  label: string;
  countLabel: string;
  className: string;
} {
  const activeCount = activeOptionsForGroup(group).length;
  const availableCount = availableActiveOptionsForGroup(group).length;

  if (!group.isActive) {
    return {
      kind: "inactive",
      label: "Hidden",
      countLabel: `${activeCount} ${activeCount === 1 ? "option" : "options"} hidden`,
      className: "border-stone-200 bg-stone-100 text-stone-500",
    };
  }

  if (activeCount === 0) {
    return {
      kind: "empty",
      label: "No options",
      countLabel: "No active options",
      className: "border-red-200 bg-red-50 text-red-800",
    };
  }

  if (availableCount === 0) {
    return {
      kind: "out",
      label: "Out",
      countLabel: `0 available · ${activeCount} active`,
      className: "border-red-200 bg-red-50 text-red-800",
    };
  }

  if (availableCount < activeCount) {
    return {
      kind: "partial",
      label: "Partial",
      countLabel: `${availableCount} available · ${activeCount} active`,
      className: "border-amber-200 bg-amber-50 text-amber-900",
    };
  }

  return {
    kind: "live",
    label: "Live",
    countLabel: `${availableCount} available options`,
    className: "border-emerald-200 bg-emerald-50 text-emerald-800",
  };
}

export default function WorkspaceModifierLibraryModal({
  groups,
  focusedGroupId = null,
  focusContext = null,
  loading,
  error,
  busyKey,
  onClose,
  onRefresh,
  onCreateGroupWithFirstOption,
  onUpdateGroup,
  onDeactivateGroup,
  onHardDeleteGroup,
  onSaveGroupDraft,
  onCreateOption,
  onHardDeleteOption,
}: Props) {
  const sortedGroups = useMemo(
    () =>
      [...groups].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      ),
    [groups],
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(
    focusContext?.groupId ?? focusedGroupId ?? sortedGroups[0]?.id ?? null,
  );
  const [itemFilterCleared, setItemFilterCleared] = useState(false);
  const appliedFocusedGroupIdRef = useRef<string | null>(null);
  const selectedGroup =
    sortedGroups.find((group) => group.id === selectedGroupId) ??
    sortedGroups[0] ??
    null;
  const focusGroupId = focusContext?.groupId ?? focusedGroupId ?? null;
  const activeFocusContext =
    focusContext &&
    !itemFilterCleared &&
    Boolean(
      selectedGroup &&
        (focusContext.itemGroupIds ?? [focusContext.groupId]).includes(
          selectedGroup.id,
        ),
    )
      ? focusContext
      : null;
  const fullLibraryItemContext =
    focusContext && itemFilterCleared ? focusContext : null;
  const itemContextGroupIds =
    focusContext?.itemGroupIds ?? (focusContext ? [focusContext.groupId] : []);
  const visibleGroups =
    activeFocusContext && focusContext
      ? sortedGroups.filter((group) =>
          itemContextGroupIds.includes(group.id),
        )
      : sortedGroups;

  useEffect(() => lockBodyScroll(), []);

  useEffect(() => {
    if (!focusGroupId || appliedFocusedGroupIdRef.current === focusGroupId) {
      return;
    }
    if (sortedGroups.some((group) => group.id === focusGroupId)) {
      setSelectedGroupId(focusGroupId);
      appliedFocusedGroupIdRef.current = focusGroupId;
    }
  }, [focusGroupId, sortedGroups]);

  useEffect(() => {
    setItemFilterCleared(false);
  }, [focusContext]);

  useEffect(() => {
    if (!selectedGroupId && sortedGroups[0]) {
      setSelectedGroupId(sortedGroups[0].id);
      return;
    }
    if (
      selectedGroupId &&
      !sortedGroups.some((group) => group.id === selectedGroupId)
    ) {
      setSelectedGroupId(sortedGroups[0]?.id ?? null);
    }
  }, [selectedGroupId, sortedGroups]);

  function returnToItemAddOns() {
    if (!focusContext) return;
    setSelectedGroupId(focusContext.groupId);
    setItemFilterCleared(false);
  }

  const modal = (
    <div
      className="fixed inset-0 z-[2147483646] flex items-center justify-center bg-black/45 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busyKey) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add-ons"
        className="flex max-h-[calc(100vh-32px)] w-full max-w-[1180px] flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
      >
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 px-6 py-4">
          <div className="min-w-0">
            <div className="text-[11px] font-black uppercase tracking-widest text-stone-500">
              Workspace menu
            </div>
            <h2 className="mt-1 text-2xl font-black text-stone-950">
              Add-ons
            </h2>
            <div className="mt-1 text-xs font-bold text-stone-500">
              Add-on sets for normal menu items. Prices belong to options, not
              the set.
            </div>
          </div>
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => void onRefresh()}
              disabled={loading || busyKey != null}
              className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-400 disabled:opacity-50"
            >
              <RefreshCw
                size={13}
                strokeWidth={2.5}
                className={loading ? "animate-spin" : ""}
                aria-hidden
              />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busyKey != null}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full text-stone-700 hover:bg-stone-100 disabled:opacity-50"
              aria-label="Close add-ons"
            >
              <X size={20} strokeWidth={2.5} aria-hidden />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
          {error && (
            <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
              {error}
            </div>
          )}

          {focusContext && itemFilterCleared && (
            <div
              className="mb-4 rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3"
              data-testid="workspace-addon-manager-full-library-banner"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
                    Full add-ons library
                  </div>
                  <div className="mt-1 text-sm font-bold text-stone-700">
                    Showing every add-on set. Return to {focusContext.itemName}'s
                    attached add-ons when you want the item-filtered view.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={returnToItemAddOns}
                  className="inline-flex items-center justify-center rounded-full border border-stone-900 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-stone-900"
                  data-testid="workspace-addon-manager-back-to-item-addons"
                >
                  Back to item add-ons
                </button>
              </div>
            </div>
          )}

          {!activeFocusContext && (
            <CreateGroupPanel
              busy={busyKey === "group:create"}
              onCreate={async (input) => {
                const created = await onCreateGroupWithFirstOption(input);
                if (created) setSelectedGroupId(created.id);
              }}
            />
          )}

          <div
            className={`grid gap-4 lg:grid-cols-[330px_minmax(0,1fr)] ${
              activeFocusContext ? "mt-0" : "mt-5"
            }`}
          >
            <aside className="rounded-2xl border border-stone-200 bg-stone-50 p-2">
              <div className="flex flex-wrap items-center justify-between gap-2 px-2 pb-2">
                <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
                  {activeFocusContext ? "Item add-on sets" : "Sets"}
                </div>
                {activeFocusContext && (
                  <button
                    type="button"
                    onClick={() => setItemFilterCleared(true)}
                    className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-stone-700"
                  >
                    Open full library
                  </button>
                )}
              </div>
              {activeFocusContext && (
                <div className="mb-2 rounded-xl border border-yellow-200 bg-yellow-50 px-3 py-2 text-[11px] font-bold text-stone-600">
                  Showing add-on sets attached to this menu item.
                </div>
              )}
              <div className="space-y-2">
                {visibleGroups.length > 0 ? (
                  visibleGroups.map((group) => {
                    const active = selectedGroup?.id === group.id;
                    const stockSummary = groupStockSummary(group);
                    const attachedToFocusedItem = Boolean(
                      fullLibraryItemContext &&
                        itemContextGroupIds.includes(group.id),
                    );
                    return (
                      <button
                        key={group.id}
                        type="button"
                        onClick={() => setSelectedGroupId(group.id)}
                        data-testid="workspace-addon-manager-set-list-item"
                        className={`w-full rounded-xl border px-3 py-3 text-left ${
                          active
                            ? "border-stone-900 bg-white shadow-sm"
                            : attachedToFocusedItem
                              ? "border-yellow-200 bg-yellow-50/40 hover:border-yellow-300"
                            : "border-stone-200 bg-white hover:border-stone-400"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-black text-stone-950">
                              {group.name}
                            </div>
                            <div className="mt-1 text-[11px] font-bold text-stone-500">
                              {stockSummary.countLabel}
                            </div>
                          </div>
                          <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1.5">
                            <span
                              className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${stockSummary.className}`}
                            >
                              {stockSummary.label}
                            </span>
                            {attachedToFocusedItem && (
                              <span
                                className="max-w-[150px] truncate rounded-full border border-yellow-200 bg-white px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-yellow-900"
                                data-testid="workspace-addon-manager-item-set-badge"
                                title={`Used by ${fullLibraryItemContext?.itemName}`}
                              >
                                Used by {fullLibraryItemContext?.itemName}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-xl border border-dashed border-stone-300 bg-white px-3 py-5 text-center text-sm font-bold text-stone-500">
                    No add-on sets yet.
                  </div>
                )}
              </div>
            </aside>

            <main className="min-w-0">
              {selectedGroup ? (
                <GroupEditor
                  group={selectedGroup}
                  busyKey={busyKey}
                  onUpdateGroup={onUpdateGroup}
                  onDeactivateGroup={onDeactivateGroup}
                  onHardDeleteGroup={onHardDeleteGroup}
                  onSaveGroupDraft={onSaveGroupDraft}
                  onCreateOption={onCreateOption}
                  onHardDeleteOption={onHardDeleteOption}
                  focusContext={activeFocusContext}
                  fullLibraryItemContext={fullLibraryItemContext}
                  focusFilterAvailable={Boolean(
                    focusContext && itemContextGroupIds.includes(selectedGroup.id),
                  )}
                  onClearFocusFilter={() => setItemFilterCleared(true)}
                />
              ) : (
                <div className="rounded-2xl border border-dashed border-stone-300 bg-stone-50 px-4 py-10 text-center text-sm font-bold text-stone-500">
                  Create an add-on set, then add priced or free options.
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(modal, document.body);
}

type CreateChoiceCount = "single" | "multiple";

type CreateAddOnSetDraft = {
  setName: string;
  firstOptionName: string;
  firstOptionPrice: number;
  stockMode: WorkspaceOptionStockPatch["stockMode"];
  isOutOfStock: boolean;
  stockQty: number;
  canSkip: boolean;
  choiceCount: CreateChoiceCount;
  minSelect: number;
  maxSelect: number | null;
};

const EMPTY_CREATE_ADD_ON_SET_DRAFT: CreateAddOnSetDraft = {
  setName: "",
  firstOptionName: "",
  firstOptionPrice: 0,
  stockMode: "MANUAL",
  isOutOfStock: false,
  stockQty: 0,
  canSkip: true,
  choiceCount: "multiple",
  minSelect: 0,
  maxSelect: null,
};

function groupFieldsFromCreateDraft(draft: CreateAddOnSetDraft): GroupFields {
  if (draft.choiceCount === "single") {
    return {
      name: draft.setName,
      description: null,
      selectionMode: draft.canSkip ? "OPTIONAL_SINGLE" : "REQUIRED_SINGLE",
      minSelect: draft.canSkip ? 0 : 1,
      maxSelect: 1,
    };
  }

  if (draft.canSkip) {
    return {
      name: draft.setName,
      description: null,
      selectionMode: "OPTIONAL_MULTI",
      minSelect: 0,
      maxSelect: draft.maxSelect,
    };
  }

  return {
    name: draft.setName,
    description: null,
    selectionMode: "REQUIRED_MULTI",
    minSelect: Math.max(1, draft.minSelect),
    maxSelect: draft.maxSelect,
  };
}

function canSkipFromSelectionMode(mode: SharedModifierSelectionMode) {
  return mode === "OPTIONAL_MULTI" || mode === "OPTIONAL_SINGLE";
}

function choiceCountFromSelectionMode(
  mode: SharedModifierSelectionMode,
): CreateChoiceCount {
  return isSingleMode(mode) ? "single" : "multiple";
}

function selectionModeFromOwnerChoices(
  canSkip: boolean,
  choiceCount: CreateChoiceCount,
): SharedModifierSelectionMode {
  if (choiceCount === "single") {
    return canSkip ? "OPTIONAL_SINGLE" : "REQUIRED_SINGLE";
  }
  return canSkip ? "OPTIONAL_MULTI" : "REQUIRED_MULTI";
}

function updateOwnerRule(
  draft: GroupFields,
  next: {
    canSkip?: boolean;
    choiceCount?: CreateChoiceCount;
    minSelect?: number;
    maxSelect?: number | null;
  },
): GroupFields {
  const canSkip = next.canSkip ?? canSkipFromSelectionMode(draft.selectionMode);
  const choiceCount =
    next.choiceCount ?? choiceCountFromSelectionMode(draft.selectionMode);
  const selectionMode = selectionModeFromOwnerChoices(canSkip, choiceCount);

  if (choiceCount === "single") {
    return normalizeRuleForMode({
      ...draft,
      selectionMode,
      minSelect: canSkip ? 0 : 1,
      maxSelect: 1,
    });
  }

  return normalizeRuleForMode({
    ...draft,
    selectionMode,
    minSelect: canSkip ? 0 : Math.max(1, next.minSelect ?? draft.minSelect),
    maxSelect:
      next.maxSelect !== undefined
        ? next.maxSelect
        : draft.maxSelect === 1
          ? null
          : draft.maxSelect,
  });
}

function CreateGroupPanel({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (
    input: CreateGroupWithFirstOptionInput
  ) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<CreateAddOnSetDraft>(
    EMPTY_CREATE_ADD_ON_SET_DRAFT,
  );
  const group = groupFieldsFromCreateDraft(draft);
  const valid =
    draft.setName.trim().length > 0 &&
    draft.firstOptionName.trim().length > 0 &&
    Number.isFinite(draft.firstOptionPrice) &&
    draft.firstOptionPrice >= 0 &&
    (draft.stockMode === "MANUAL" ||
      (Number.isInteger(draft.stockQty) && draft.stockQty >= 0)) &&
    ruleValid(group);

  async function submit() {
    if (!valid || busy) return;
    await onCreate({
      group: {
        ...group,
        name: draft.setName.trim(),
        description: null,
      },
      firstOption: {
        name: draft.firstOptionName.trim(),
        priceDelta: roundMoney(draft.firstOptionPrice),
        stockMode: draft.stockMode,
        isOutOfStock:
          draft.stockMode === "MANUAL" ? draft.isOutOfStock : false,
        stockQty: draft.stockMode === "QUANTITY" ? draft.stockQty : null,
        lowStockThreshold: null,
      },
    });
    setDraft(EMPTY_CREATE_ADD_ON_SET_DRAFT);
  }

  return (
    <form
      className="rounded-2xl border border-yellow-200 bg-yellow-50/60 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_180px_220px_150px_150px] lg:items-end">
        <LibraryField
          label="New add-on set"
          help="The set groups options together."
        >
          <input
            value={draft.setName}
            onChange={(event) =>
              setDraft({ ...draft, setName: event.target.value })
            }
            placeholder="Burger add-ons"
            className={INPUT_CLS}
            style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
          />
        </LibraryField>
        <LibraryField label="Can customers skip it?">
          <select
            value={draft.canSkip ? "yes" : "no"}
            onChange={(event) =>
              setDraft({
                ...draft,
                canSkip: event.target.value === "yes",
                minSelect:
                  event.target.value === "yes"
                    ? 0
                    : Math.max(1, draft.minSelect),
              })
            }
            className={INPUT_CLS}
            style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
          >
            <option value="yes">Yes, optional</option>
            <option value="no">No, required</option>
          </select>
        </LibraryField>
        <LibraryField label="How many can they choose?">
          <select
            value={draft.choiceCount}
            onChange={(event) =>
              setDraft({
                ...draft,
                choiceCount: event.target.value as CreateChoiceCount,
                maxSelect:
                  event.target.value === "single"
                    ? 1
                    : draft.maxSelect === 1
                      ? null
                      : draft.maxSelect,
              })
            }
            className={INPUT_CLS}
            style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
          >
            <option value="multiple">More than one</option>
            <option value="single">Only one</option>
          </select>
        </LibraryField>
        {draft.choiceCount === "multiple" && !draft.canSkip ? (
          <RuleNumberInput
            label="Minimum"
            value={draft.minSelect}
            onChange={(minSelect) =>
              setDraft({ ...draft, minSelect: Math.max(1, minSelect ?? 1) })
            }
          />
        ) : (
          <LibraryField label="Starts at">
            <div className="rounded-xl border border-stone-200 bg-white/70 px-3 py-2.5 text-sm font-black uppercase tracking-widest text-stone-500">
              {draft.canSkip ? "0" : "1"}
            </div>
          </LibraryField>
        )}
        {draft.choiceCount === "multiple" ? (
          <RuleNumberInput
            label="Maximum"
            value={draft.maxSelect}
            onChange={(maxSelect) => setDraft({ ...draft, maxSelect })}
            nullable
          />
        ) : (
          <LibraryField label="Maximum">
            <div className="rounded-xl border border-stone-200 bg-white/70 px-3 py-2.5 text-sm font-black uppercase tracking-widest text-stone-500">
              1
            </div>
          </LibraryField>
        )}
      </div>

      <div className="mt-4 border-t border-yellow-200 pt-4">
        <div className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_140px_180px_150px_auto] lg:items-end">
          <LibraryField
            label="First option"
            help="Add at least one option now."
          >
            <input
              value={draft.firstOptionName}
              onChange={(event) =>
                setDraft({ ...draft, firstOptionName: event.target.value })
              }
              placeholder="Extra cheese"
              className={INPUT_CLS}
              style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
            />
          </LibraryField>
          <LibraryField label="Option price">
            <MoneyInput
              value={draft.firstOptionPrice}
              onChange={(firstOptionPrice) =>
                setDraft({ ...draft, firstOptionPrice })
              }
            />
          </LibraryField>
          <LibraryField
            label="First option stock"
            help={
              draft.stockMode === "QUANTITY"
                ? "Quantity controls this option's availability."
                : "Manual is a simple in/out switch for this option."
            }
          >
            <select
              value={draft.stockMode}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  stockMode:
                    event.target.value as WorkspaceOptionStockPatch["stockMode"],
                  stockQty:
                    event.target.value === "QUANTITY" ? draft.stockQty : 0,
                })
              }
              className={INPUT_CLS}
              style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
            >
              <option value="MANUAL">Manual in / out</option>
              <option value="QUANTITY">Track quantity</option>
            </select>
          </LibraryField>
          {draft.stockMode === "QUANTITY" ? (
            <RuleNumberInput
              label="First option qty"
              value={draft.stockQty}
              onChange={(stockQty) =>
                setDraft({ ...draft, stockQty: stockQty ?? 0 })
              }
            />
          ) : (
            <LibraryField label="First option starts">
              <button
                type="button"
                onClick={() =>
                  setDraft({ ...draft, isOutOfStock: !draft.isOutOfStock })
                }
                className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm font-black uppercase tracking-widest ${
                  draft.isOutOfStock
                    ? "border-red-200 bg-red-50 text-red-800"
                    : "border-emerald-200 bg-emerald-50 text-emerald-800"
                }`}
              >
                {draft.isOutOfStock ? "Out of stock" : "In stock"}
              </button>
            </LibraryField>
          )}
          <button
            type="submit"
            disabled={!valid || busy}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-stone-950 px-4 py-3 text-[11px] font-black uppercase tracking-widest text-yellow-300 disabled:opacity-50"
          >
            <Plus size={14} strokeWidth={2.5} aria-hidden />
            Create
          </button>
        </div>
      </div>
    </form>
  );
}

function GroupEditor({
  group,
  busyKey,
  onUpdateGroup,
  onDeactivateGroup,
  onHardDeleteGroup,
  onSaveGroupDraft,
  onCreateOption,
  onHardDeleteOption,
  focusContext,
  fullLibraryItemContext,
  focusFilterAvailable,
  onClearFocusFilter,
}: {
  group: SharedModifierGroup;
  busyKey: string | null;
  onUpdateGroup: (
    group: SharedModifierGroup,
    fields: Partial<GroupFields & { isActive: boolean }>
  ) => void | Promise<void>;
  onDeactivateGroup: (group: SharedModifierGroup) => void | Promise<void>;
  onHardDeleteGroup: (group: SharedModifierGroup) => void | Promise<void>;
  onSaveGroupDraft: (
    group: SharedModifierGroup,
    input: SaveGroupDraftInput
  ) => void | Promise<void>;
  onCreateOption: (
    group: SharedModifierGroup,
    input: OptionFields
  ) => void | Promise<void>;
  onHardDeleteOption: (
    group: SharedModifierGroup,
    option: SharedModifierOption
  ) => void | Promise<void>;
  focusContext?: WorkspaceAddOnManagerFocus | null;
  fullLibraryItemContext?: WorkspaceAddOnManagerFocus | null;
  focusFilterAvailable: boolean;
  onClearFocusFilter: () => void;
}) {
  const [draft, setDraft] = useState<GroupFields>(groupFields(group));
  const [optionDraft, setOptionDraft] = useState<OptionFields>({
    name: "",
    priceDelta: 0,
  });
  const [optionDrafts, setOptionDrafts] = useState<
    Record<string, OptionEditorFields>
  >(() =>
    Object.fromEntries(
      group.options.map((option) => [option.id, optionFields(option)])
    )
  );
  const optionOriginalsRef = useRef<Record<string, OptionEditorFields>>(
    Object.fromEntries(
      group.options.map((option) => [option.id, optionFields(option)])
    ),
  );
  const [optionCreateOpen, setOptionCreateOpen] = useState(false);
  const groupBusy =
    busyKey === `group:${group.id}` || busyKey === `group:${group.id}:delete`;
  const valid = draft.name.trim().length > 0 && ruleValid(draft);
  const dirty = JSON.stringify(draft) !== JSON.stringify(groupFields(group));
  const optionValid =
    optionDraft.name.trim().length > 0 &&
    Number.isFinite(optionDraft.priceDelta) &&
    optionDraft.priceDelta >= 0;
  const sortedOptions = useMemo(
    () =>
      [...group.options].sort(
        (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
      ),
    [group.options],
  );
  const optionDraftList = sortedOptions.map(
    (option) => optionDrafts[option.id] ?? optionFields(option),
  );
  const optionsValid = optionDraftList.every(optionFieldsValid);
  const optionsDirty = sortedOptions.some((option) => {
    const currentDraft = optionDrafts[option.id] ?? optionFields(option);
    return !optionFieldsEqual(currentDraft, optionFields(option));
  });
  const canSave = valid && optionsValid && (dirty || optionsDirty);
  const canSkip = canSkipFromSelectionMode(draft.selectionMode);
  const choiceCount = choiceCountFromSelectionMode(draft.selectionMode);
  const stockSummary = groupStockSummary(group);
  const focusMode = Boolean(focusContext);
  const focusedOptionIds = useMemo(() => {
    const optionIds =
      focusContext?.itemOptionIdsByGroupId?.[group.id] ??
      (focusContext?.groupId === group.id ? focusContext.optionIds : []);
    return new Set(optionIds);
  }, [focusContext, group.id]);
  const itemContextGroupIds =
    fullLibraryItemContext?.itemGroupIds ??
    (fullLibraryItemContext ? [fullLibraryItemContext.groupId] : []);
  const itemContextAppliesToGroup = Boolean(
    fullLibraryItemContext && itemContextGroupIds.includes(group.id),
  );
  const itemContextOptionIds = useMemo(() => {
    const optionIds =
      fullLibraryItemContext?.itemOptionIdsByGroupId?.[group.id] ??
      (fullLibraryItemContext?.groupId === group.id
        ? fullLibraryItemContext.optionIds
        : []);
    return new Set(optionIds);
  }, [fullLibraryItemContext, group.id]);
  const displayedOptions = focusContext
    ? sortedOptions.filter(
        (option) => option.isActive && focusedOptionIds.has(option.id),
      )
    : sortedOptions;

  useEffect(() => {
    const nextOriginals = Object.fromEntries(
      group.options.map((option) => [option.id, optionFields(option)])
    );
    setDraft(groupFields(group));
    setOptionDrafts(nextOriginals);
    optionOriginalsRef.current = nextOriginals;
  }, [group.id, group.lockVersion]);

  useEffect(() => {
    const nextOriginals = Object.fromEntries(
      group.options.map((option) => [option.id, optionFields(option)])
    );
    setOptionDrafts((currentDrafts) => {
      const previousOriginals = optionOriginalsRef.current;
      const nextDrafts: Record<string, OptionEditorFields> = {};
      for (const option of group.options) {
        const nextOriginal = nextOriginals[option.id];
        const currentDraft = currentDrafts[option.id];
        const previousOriginal = previousOriginals[option.id];
        nextDrafts[option.id] =
          !currentDraft ||
          !previousOriginal ||
          optionFieldsEqual(currentDraft, previousOriginal)
            ? nextOriginal
            : currentDraft;
      }
      return nextDrafts;
    });
    optionOriginalsRef.current = nextOriginals;
  }, [group.options]);

  useEffect(() => {
    setOptionDraft({ name: "", priceDelta: 0 });
    setOptionCreateOpen(false);
  }, [group.id]);

  async function saveGroup() {
    if (!canSave || groupBusy || busyKey != null) return;
    await onSaveGroupDraft(group, {
      group: {
        ...draft,
        name: draft.name.trim(),
        description: draft.description?.trim() || null,
      },
      options: optionDraftList.map((option) => ({
        ...option,
        name: option.name.trim(),
        priceDelta: roundMoney(option.priceDelta),
      })),
    });
  }

  async function addOption() {
    if (!optionValid || busyKey != null) return;
    await onCreateOption(group, {
      name: optionDraft.name.trim(),
      priceDelta: roundMoney(optionDraft.priceDelta),
    });
    setOptionDraft({ name: "", priceDelta: 0 });
    setOptionCreateOpen(false);
  }

  return (
    <div className="rounded-2xl border border-stone-200 bg-white">
      <div className="border-b border-stone-200 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
              Add-on set
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <div className="truncate text-xl font-black text-stone-950">
                {group.name}
              </div>
              <span
                className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${stockSummary.className}`}
              >
                {stockSummary.label}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {!group.isActive && (
              <button
                type="button"
                onClick={() => void onUpdateGroup(group, { isActive: true })}
                disabled={groupBusy || busyKey != null}
                className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-800 disabled:opacity-50"
              >
                Show
              </button>
            )}
            {group.isActive && (
              <button
                type="button"
                onClick={() => void onDeactivateGroup(group)}
                disabled={groupBusy || busyKey != null}
                className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-700 disabled:opacity-50"
              >
                <Trash2 size={13} strokeWidth={2.5} aria-hidden />
                Hide
              </button>
            )}
            {group.canHardDelete && (
              <button
                type="button"
                onClick={() => void onHardDeleteGroup(group)}
                disabled={groupBusy || busyKey != null}
                title="Permanently delete this add-on set."
                className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-700 disabled:text-stone-400 disabled:opacity-60"
              >
                <Trash2 size={13} strokeWidth={2.5} aria-hidden />
                Delete set
              </button>
            )}
          </div>
        </div>

        {stockSummary.kind === "out" && (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
            All active options in this add-on set are out of stock. Customers
            cannot choose this set until at least one option is available.
          </div>
        )}

        {stockSummary.kind === "partial" && (
          <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-900">
            Some options in this add-on set are out of stock. Customers will
            only be able to choose the available options.
          </div>
        )}

        {focusContext && (
          <div
            className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3"
            data-testid="workspace-addon-manager-focus-banner"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-widest text-yellow-900">
                  Item stock focus
                </div>
                <div className="mt-1 text-sm font-black text-stone-950">
                  Managing stock for {focusContext.itemName} · {group.name}
                </div>
                <div className="mt-1 text-xs font-bold text-stone-600">
                  Showing {displayedOptions.length} item-visible{" "}
                  {displayedOptions.length === 1 ? "option" : "options"}. Stock
                  changes affect this add-on everywhere it is used.
                </div>
              </div>
              <button
                type="button"
                onClick={onClearFocusFilter}
                className="inline-flex items-center justify-center rounded-full border border-yellow-300 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-stone-800"
                data-testid="workspace-addon-manager-clear-filter"
              >
                Open full library
              </button>
            </div>
          </div>
        )}

        {!focusContext && focusFilterAvailable && (
          <div className="mt-4 rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-xs font-bold text-stone-600">
            Showing all options for this add-on set.
          </div>
        )}

        {!focusContext && itemContextAppliesToGroup && fullLibraryItemContext && (
          <div
            className="mt-4 rounded-xl border border-yellow-200 bg-yellow-50/50 px-4 py-3"
            data-testid="workspace-addon-manager-item-context-banner"
          >
            <div className="text-[10px] font-black uppercase tracking-widest text-yellow-900">
              Item context
            </div>
            <div className="mt-1 text-xs font-bold text-stone-600">
              Highlighted options are used by {fullLibraryItemContext.itemName}.
              The full library remains editable.
            </div>
          </div>
        )}

        {!focusMode && (
          <div className="mt-4 space-y-4">
            <div className="grid gap-3 lg:grid-cols-[minmax(260px,420px)_minmax(0,1fr)]">
              <LibraryField label="Name">
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  className={INPUT_CLS}
                  style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                />
              </LibraryField>
              <LibraryField label="Internal note">
                <input
                  value={draft.description ?? ""}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      description: event.target.value || null,
                    })
                  }
                  placeholder="Optional"
                  className={INPUT_CLS}
                  style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                />
              </LibraryField>
            </div>

            <div className="rounded-2xl border border-stone-200 bg-stone-50/70 p-3">
              <div className="mb-3 text-[10px] font-black uppercase tracking-widest text-stone-500">
                Customer choice
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(170px,220px)_minmax(190px,1fr)_120px_120px]">
                <LibraryField label="Can customers skip it?">
                  <select
                    value={canSkip ? "yes" : "no"}
                    onChange={(event) =>
                      setDraft(
                        updateOwnerRule(draft, {
                          canSkip: event.target.value === "yes",
                        }),
                      )
                    }
                    className={INPUT_CLS}
                    style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                  >
                    <option value="yes">Yes, optional</option>
                    <option value="no">No, required</option>
                  </select>
                </LibraryField>
                <LibraryField label="How many can they choose?">
                  <select
                    value={choiceCount}
                    onChange={(event) =>
                      setDraft(
                        updateOwnerRule(draft, {
                          choiceCount: event.target.value as CreateChoiceCount,
                        }),
                      )
                    }
                    className={INPUT_CLS}
                    style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                  >
                    <option value="multiple">More than one</option>
                    <option value="single">Only one</option>
                  </select>
                </LibraryField>
                {choiceCount === "multiple" && !canSkip ? (
                  <RuleNumberInput
                    label="Minimum"
                    value={draft.minSelect}
                    onChange={(minSelect) =>
                      setDraft(
                        updateOwnerRule(draft, {
                          minSelect: Math.max(1, minSelect ?? 1),
                        }),
                      )
                    }
                  />
                ) : (
                  <LibraryField label="Starts at">
                    <div className="rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-black uppercase tracking-widest text-stone-500">
                      {canSkip ? "0" : "1"}
                    </div>
                  </LibraryField>
                )}
                {choiceCount === "multiple" ? (
                  <RuleNumberInput
                    label="Maximum"
                    value={draft.maxSelect}
                    onChange={(maxSelect) =>
                      setDraft(updateOwnerRule(draft, { maxSelect }))
                    }
                    nullable
                  />
                ) : (
                  <LibraryField label="Maximum">
                    <div className="rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-black uppercase tracking-widest text-stone-500">
                      1
                    </div>
                  </LibraryField>
                )}
              </div>
            </div>
          </div>
        )}

      </div>

      <div className="p-4">
        {focusMode && (
          <div
            className="mb-4 rounded-2xl border border-yellow-200 bg-yellow-50/50 px-4 py-3"
            data-testid="workspace-addon-manager-focused-options-panel"
          >
            <div className="text-[10px] font-black uppercase tracking-widest text-yellow-900">
              Focused options for this item
            </div>
            <div className="mt-1 text-sm font-bold text-stone-700">
              Showing item-visible options from the selected add-on set. Use the
              left set list to switch between add-on sets attached to this menu
              item, or Open full library to edit the full library.
            </div>
          </div>
        )}

        {!focusMode && optionCreateOpen ? (
          <form
            className="mb-4 rounded-2xl border border-yellow-200 bg-yellow-50/50 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void addOption();
            }}
          >
            <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_140px_auto_auto] md:items-end">
              <LibraryField
                label="New option"
                help="Examples: Extra cheese, No onion, Ranch dressing."
              >
                <input
                  value={optionDraft.name}
                  onChange={(event) =>
                    setOptionDraft({ ...optionDraft, name: event.target.value })
                  }
                  placeholder="Extra cheese"
                  className={INPUT_CLS}
                  style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                  autoFocus
                />
              </LibraryField>
              <LibraryField label="Option price">
                <MoneyInput
                  value={optionDraft.priceDelta}
                  onChange={(priceDelta) =>
                    setOptionDraft({ ...optionDraft, priceDelta })
                  }
                />
              </LibraryField>
              <button
                type="submit"
                disabled={!optionValid || busyKey != null}
                className="inline-flex items-center justify-center gap-2 rounded-full border border-stone-900 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-stone-900 disabled:opacity-50"
              >
                <Plus size={13} strokeWidth={2.5} aria-hidden />
                Add option
              </button>
              <button
                type="button"
                onClick={() => {
                  setOptionDraft({ name: "", priceDelta: 0 });
                  setOptionCreateOpen(false);
                }}
                disabled={busyKey != null}
                className="inline-flex items-center justify-center rounded-full border border-stone-200 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-stone-700 disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : !focusMode ? (
          <div className="mb-4 flex justify-end">
            <button
              type="button"
              onClick={() => setOptionCreateOpen(true)}
              disabled={busyKey != null}
              className="inline-flex items-center justify-center gap-2 rounded-full border border-stone-900 bg-white px-4 py-3 text-[10px] font-black uppercase tracking-widest text-stone-900 disabled:opacity-50"
            >
              <Plus size={13} strokeWidth={2.5} aria-hidden />
              Add option
            </button>
          </div>
        ) : null}

        <div className="mt-4 space-y-2">
          {displayedOptions.map((option) => {
            const highlightedByItemContext =
              !focusMode &&
              itemContextAppliesToGroup &&
              itemContextOptionIds.has(option.id);
            return (
              <OptionEditorRow
                key={option.id}
                group={group}
                option={option}
                draft={optionDrafts[option.id] ?? optionFields(option)}
                onDraftChange={(nextDraft) =>
                  setOptionDrafts((drafts) => ({
                    ...drafts,
                    [option.id]: nextDraft,
                  }))
                }
                busyKey={busyKey}
                onHardDeleteOption={onHardDeleteOption}
                highlighted={Boolean(focusContext) || highlightedByItemContext}
                itemContextLabel={
                  highlightedByItemContext && fullLibraryItemContext
                    ? `Used by ${fullLibraryItemContext.itemName}`
                    : null
                }
              />
            );
          })}
          {group.options.length === 0 && (
            <div className="rounded-xl border border-dashed border-stone-300 bg-stone-50 px-3 py-6 text-center text-sm font-bold text-stone-500">
              Add options such as Extra cheese, No onion, or Dressing choice.
            </div>
          )}
          {focusContext && group.options.length > 0 && displayedOptions.length === 0 && (
            <div className="rounded-xl border border-dashed border-yellow-300 bg-yellow-50/60 px-3 py-6 text-center text-sm font-bold text-stone-600">
              No item-visible options match this menu item's attachment for
              this set. Open full library to manage the full add-on library.
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-10 rounded-b-2xl border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs font-bold text-stone-500">
            {stockSummary.countLabel} · {group.options.length} total options.
          </div>
          <button
            type="button"
            onClick={() => void saveGroup()}
            disabled={!canSave || groupBusy || busyKey != null}
            className="inline-flex items-center gap-2 rounded-full bg-stone-950 px-4 py-2.5 text-[10px] font-black uppercase tracking-widest text-yellow-300 disabled:opacity-50"
          >
            <Save size={13} strokeWidth={2.5} aria-hidden />
            Save add-on set
          </button>
        </div>
      </div>
    </div>
  );
}

function OptionEditorRow({
  group,
  option,
  draft,
  onDraftChange,
  busyKey,
  onHardDeleteOption,
  highlighted,
  itemContextLabel,
}: {
  group: SharedModifierGroup;
  option: SharedModifierOption;
  draft: OptionEditorFields;
  onDraftChange: (draft: OptionEditorFields) => void;
  busyKey: string | null;
  onHardDeleteOption: (
    group: SharedModifierGroup,
    option: SharedModifierOption
  ) => void | Promise<void>;
  highlighted?: boolean;
  itemContextLabel?: string | null;
}) {
  const rowBusy = busyKey != null;
  const active = draft.isActive;
  const original = optionFields(option);
  const dirty = !optionFieldsEqual(draft, original);
  const valid = optionFieldsValid(draft);
  const canDelete = Boolean(group.canHardDelete) && !dirty;

  return (
    <div
      data-testid="workspace-addon-manager-option-row"
      className={`rounded-2xl border px-3 py-3 ${
        highlighted
          ? "border-yellow-300 bg-yellow-50/40"
          : active
            ? "border-stone-200 bg-white"
            : "border-stone-200 bg-stone-50 text-stone-500"
      }`}
    >
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_140px_auto] lg:items-start">
        <div className="min-w-0">
          <input
            value={draft.name}
            onChange={(event) =>
              onDraftChange({ ...draft, name: event.target.value })
            }
            disabled={rowBusy || busyKey != null}
            className={`${INPUT_CLS} ${active ? "" : "text-stone-500"}`}
            style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
            aria-label={`Option name for ${option.name}`}
          />
        </div>
        <MoneyInput
          value={draft.priceDelta}
          onChange={(priceDelta) => onDraftChange({ ...draft, priceDelta })}
          disabled={rowBusy || busyKey != null}
        />
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          {active ? (
            <button
              type="button"
              onClick={() => onDraftChange({ ...draft, isActive: false })}
              disabled={rowBusy || busyKey != null}
              className="rounded-full border border-red-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-700 disabled:opacity-50"
            >
              Hide
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onDraftChange({ ...draft, isActive: true })}
              disabled={rowBusy || busyKey != null}
              className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-800 disabled:opacity-50"
            >
              Show
            </button>
          )}
          {group.canHardDelete && (
            <button
              type="button"
              onClick={() => void onHardDeleteOption(group, option)}
              disabled={!canDelete || rowBusy || busyKey != null}
              title={
                dirty
                  ? "Save or discard this option's changes before deleting it."
                  : "Permanently delete this add-on option."
              }
              className="rounded-full border border-red-200 bg-white px-3 py-2 text-[10px] font-black uppercase tracking-widest text-red-700 disabled:text-stone-400 disabled:opacity-60"
            >
              Delete
            </button>
          )}
        </div>
      </div>
      <div className="mt-3 grid gap-2 border-t border-stone-100 pt-3 xl:grid-cols-[auto_minmax(0,1fr)] xl:items-center">
        <div className="flex flex-wrap items-center gap-1.5">
          <ModifierOptionStockBadge option={draft} />
          {itemContextLabel && (
            <span
              className="rounded-full border border-yellow-200 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-yellow-900"
              data-testid="workspace-addon-manager-item-option-badge"
            >
              {itemContextLabel}
            </span>
          )}
          {!active && (
            <span className="rounded-full border border-stone-200 bg-white px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-stone-500">
              Hidden
            </span>
          )}
          {dirty && valid && (
            <span className="rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-yellow-900">
              Unsaved
            </span>
          )}
          {!valid && (
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-red-800">
              Check fields
            </span>
          )}
        </div>
        <WorkspaceOptionStockControls
          value={draft}
          layout="inline"
          showSaveButton={false}
          busy={false}
          disabled={busyKey != null}
          onChange={(patch) => onDraftChange({ ...draft, ...patch })}
          onSave={() => undefined}
        />
      </div>
    </div>
  );
}

function RuleNumberInput({
  label,
  value,
  disabled,
  nullable,
  onChange,
}: {
  label: string;
  value: number | null;
  disabled?: boolean;
  nullable?: boolean;
  onChange: (value: number | null) => void;
}) {
  return (
    <LibraryField label={label}>
      <input
        type="number"
        min={0}
        step={1}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => {
          const raw = event.target.value;
          onChange(raw === "" && nullable ? null : Math.max(0, Number(raw) || 0));
        }}
        className={INPUT_CLS}
        style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
      />
    </LibraryField>
  );
}

function MoneyInput({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs font-bold text-stone-500">
        $
      </span>
      <input
        type="number"
        min={0}
        step={0.01}
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        className={`${INPUT_CLS} pl-7 font-mono`}
        style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
      />
    </div>
  );
}

function LibraryField({
  as = "label",
  label,
  help,
  children,
}: {
  as?: "label" | "div";
  label: string;
  help?: string;
  children: ReactNode;
}) {
  const childrenContent = (
    <>
      <span className="mb-1.5 block text-[10px] font-black uppercase tracking-widest text-stone-600">
        {label}
      </span>
      {children}
      {help && (
        <span className="mt-1 block text-[11px] font-bold leading-snug text-stone-500">
          {help}
        </span>
      )}
    </>
  );

  if (as === "div") {
    return <div className="block min-w-0">{childrenContent}</div>;
  }

  return <label className="block min-w-0">{childrenContent}</label>;
}

function groupFields(group: SharedModifierGroup): GroupFields {
  return {
    name: group.name,
    description: group.description,
    selectionMode: group.selectionMode,
    minSelect: group.minSelect,
    maxSelect: group.maxSelect,
  };
}

function normalizeRuleForMode(draft: GroupFields): GroupFields {
  if (draft.selectionMode === "OPTIONAL_SINGLE") {
    return { ...draft, minSelect: 0, maxSelect: 1 };
  }
  if (draft.selectionMode === "REQUIRED_SINGLE") {
    return { ...draft, minSelect: 1, maxSelect: 1 };
  }
  if (draft.selectionMode === "REQUIRED_MULTI") {
    return { ...draft, minSelect: Math.max(1, draft.minSelect), maxSelect: draft.maxSelect };
  }
  return { ...draft, minSelect: Math.max(0, draft.minSelect) };
}

function isSingleMode(selectionMode: SharedModifierSelectionMode) {
  return selectionMode === "OPTIONAL_SINGLE" || selectionMode === "REQUIRED_SINGLE";
}

function ruleValid(draft: GroupFields) {
  if (!Number.isInteger(draft.minSelect) || draft.minSelect < 0) return false;
  if (draft.maxSelect != null) {
    if (
      !Number.isInteger(draft.maxSelect) ||
      draft.maxSelect < 1 ||
      draft.maxSelect < draft.minSelect
    ) {
      return false;
    }
  }
  if (draft.selectionMode === "OPTIONAL_SINGLE") {
    return draft.minSelect === 0 && draft.maxSelect === 1;
  }
  if (draft.selectionMode === "REQUIRED_SINGLE") {
    return draft.minSelect === 1 && draft.maxSelect === 1;
  }
  if (draft.selectionMode === "REQUIRED_MULTI") {
    return draft.minSelect >= 1;
  }
  return true;
}

function roundMoney(value: number) {
  return Math.round(Math.max(0, value) * 100) / 100;
}
