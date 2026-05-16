"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Eye,
  EyeOff,
  Link2,
  Plus,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { BRAND } from "@/lib/brand";
import { isOptionLowStock, optionStockLabel } from "@/lib/option-stock";
import type {
  Item,
  ItemModifierGroupLink,
  OptionStockMode,
  SharedModifierGroup,
  SharedModifierOption,
  SharedModifierSelectionMode,
  WorkspaceAddOnManagerFocus,
} from "./types";

type Props = {
  item: Item;
  groups: SharedModifierGroup[];
  busyKey: string | null;
  canWrite: boolean;
  onOpenLibrary?: (
    groupId?: string,
    focus?: WorkspaceAddOnManagerFocus,
  ) => void | Promise<void>;
  onChangeLinks: (links: ItemModifierGroupLink[]) => void;
};

const INPUT_CLS =
  "w-full rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-sm font-bold text-stone-900 outline-none focus:border-stone-900 focus:ring-2";

export default function SharedModifiersWorkspacePanel({
  item,
  groups,
  busyKey,
  canWrite,
  onOpenLibrary,
  onChangeLinks,
}: Props) {
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [quickName, setQuickName] = useState("");
  const [quickPrice, setQuickPrice] = useState("0");
  const [quickStockMode, setQuickStockMode] = useState<OptionStockMode>("QUANTITY");
  const [quickStockQty, setQuickStockQty] = useState("0");
  const [quickError, setQuickError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const activeLinks = useMemo(
    () =>
      [...(item.modifierGroupLinks ?? [])]
        .filter((link) => link.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [item.modifierGroupLinks],
  );
  const attachedGroupIds = useMemo(
    () => new Set(activeLinks.map((link) => link.modifierGroupId)),
    [activeLinks],
  );
  const availableGroups = useMemo(
    () =>
      groups.filter(
        (group) => group.isActive && !attachedGroupIds.has(group.id),
      ),
    [attachedGroupIds, groups],
  );
  const quickQuery = quickName.trim();
  const quickSuggestions = useMemo(() => {
    const normalizedQuery = normalizeName(quickQuery);
    if (normalizedQuery.length < 2) return [];
    return availableGroups
      .filter((group) => groupMatchesQuery(group, normalizedQuery))
      .slice(0, 4);
  }, [availableGroups, quickQuery]);
  const quickExistingNameMatch = useMemo(() => {
    const normalizedQuery = normalizeName(quickQuery);
    if (!normalizedQuery) return false;
    return (
      groups.some((group) => normalizeName(group.name) === normalizedQuery) ||
      activeLinks.some(
        (link) => normalizeName(link.modifierGroup.name) === normalizedQuery,
      )
    );
  }, [activeLinks, groups, quickQuery]);
  useEffect(() => {
    if (
      selectedGroupId &&
      !availableGroups.some((group) => group.id === selectedGroupId)
    ) {
      setSelectedGroupId("");
    }
  }, [availableGroups, selectedGroupId]);

  function handleQuickCreate(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (busyKey || !canWrite) return;
    const name = quickName.trim();
    if (!name) {
      setQuickError("Add-on name is required.");
      return;
    }
    const normalized = normalizeName(name);
    const availableExactGroup = availableGroups.find(
      (group) => normalizeName(group.name) === normalized,
    );
    if (availableExactGroup) {
      attachExistingGroup(availableExactGroup);
      setQuickName("");
      setQuickPrice("0");
      setQuickStockMode("QUANTITY");
      setQuickStockQty("0");
      setQuickError(null);
      return;
    }
    const attachedDuplicate = activeLinks.some(
      (link) => normalizeName(link.modifierGroup.name) === normalized,
    );
    if (attachedDuplicate) {
      setQuickError("That add-on set is already attached to this item.");
      return;
    }
    const duplicate = groups.some(
      (group) => normalizeName(group.name) === normalized,
    );
    if (duplicate) {
      setQuickError("An add-on set with that name already exists.");
      return;
    }
    const price = parsePriceInput(quickPrice);
    if (price == null) {
      setQuickError("Price must be 0 or more.");
      return;
    }
    const stockQty =
      quickStockMode === "QUANTITY" ? parseQuantityInput(quickStockQty) : null;
    if (quickStockMode === "QUANTITY" && stockQty == null) {
      setQuickError("Quantity must be a whole number 0 or more.");
      return;
    }

    const now = new Date().toISOString();
    const groupId = makeDraftId("new-group");
    const optionId = makeDraftId("new-option");
    const group: SharedModifierGroup = {
      id: groupId,
      outletId: "draft",
      name,
      description: null,
      selectionMode: "OPTIONAL_SINGLE",
      minSelect: 0,
      maxSelect: 1,
      isActive: true,
      sortOrder: groups.length + activeLinks.length,
      lockVersion: 0,
      createdAt: now,
      updatedAt: now,
      options: [
        {
          id: optionId,
          groupId,
          name,
          priceDelta: price,
          isActive: true,
          stockMode: quickStockMode,
          isOutOfStock: false,
          stockQty: quickStockMode === "QUANTITY" ? stockQty ?? 0 : null,
          lowStockThreshold: null,
          stockUpdatedAt: null,
          stockUpdatedById: null,
          sortOrder: 0,
          createdAt: now,
          updatedAt: now,
        },
      ],
    };
    const links = item.modifierGroupLinks ?? [];
    onChangeLinks([
      ...links,
      {
        id: makeDraftId("new-link"),
        outletId: group.outletId,
        menuItemId: item.id,
        modifierGroupId: group.id,
        sortOrder: activeLinks.length,
        minSelectOverride: null,
        maxSelectOverride: null,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        modifierGroup: group,
        optionOverrides: [],
      },
    ]);
    setQuickName("");
    setQuickPrice("0");
    setQuickStockMode("QUANTITY");
    setQuickStockQty("0");
    setQuickError(null);
  }

  function attachExistingGroup(group: SharedModifierGroup) {
    if (busyKey || !canWrite || attachedGroupIds.has(group.id)) return;
    const now = new Date().toISOString();
    const links = item.modifierGroupLinks ?? [];
    const existingLink = links.find(
      (link) => link.modifierGroupId === group.id,
    );

    if (existingLink) {
      onChangeLinks(
        links.map((link) =>
          link.id === existingLink.id
            ? {
                ...link,
                isActive: true,
                sortOrder: activeLinks.length,
                updatedAt: now,
              }
            : link,
        ),
      );
    } else {
      onChangeLinks([
        ...links,
        {
          id: `new-link-${group.id}-${Date.now()}`,
          outletId: group.outletId,
          menuItemId: item.id,
          modifierGroupId: group.id,
          sortOrder: activeLinks.length,
          minSelectOverride: null,
          maxSelectOverride: null,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          modifierGroup: group,
          optionOverrides: [],
        },
      ]);
    }
  }

  function handleAttach() {
    if (!selectedGroupId || busyKey) return;
    const group = availableGroups.find((candidate) => candidate.id === selectedGroupId);
    if (!group) return;
    attachExistingGroup(group);
    setSelectedGroupId("");
  }

  function handleDetach(link: ItemModifierGroupLink) {
    const links = item.modifierGroupLinks ?? [];
    if (link.id.startsWith("new-link-")) {
      onChangeLinks(links.filter((candidate) => candidate.id !== link.id));
      return;
    }
    const now = new Date().toISOString();
    onChangeLinks(
      links.map((candidate) =>
        candidate.id === link.id
          ? { ...candidate, isActive: false, updatedAt: now }
          : candidate,
      ),
    );
  }

  function handleManageGroupStock(link: ItemModifierGroupLink) {
    if (!onOpenLibrary || busyKey || !canWrite) return;
    if (link.modifierGroupId.startsWith("new-group-")) {
      setActionError("Save this item before managing stock for a newly created add-on set.");
      return;
    }
    const savedLinks = activeLinks.filter(
      (candidate) => !candidate.modifierGroupId.startsWith("new-group-"),
    );
    const itemOptionIdsByGroupId = Object.fromEntries(
      savedLinks.map((candidate) => [
        candidate.modifierGroupId,
        visibleActiveOptionsForLink(candidate).map((option) => option.id),
      ]),
    );
    setActionError(null);
    void onOpenLibrary(link.modifierGroupId, {
      source: "item-editor-stock",
      itemId: item.id,
      itemName: item.name || "this item",
      itemLinkId: link.id,
      groupId: link.modifierGroupId,
      optionIds: itemOptionIdsByGroupId[link.modifierGroupId] ?? [],
      itemGroupIds: savedLinks.map((candidate) => candidate.modifierGroupId),
      itemOptionIdsByGroupId,
    });
  }

  function handleToggleOptionHidden(
    link: ItemModifierGroupLink,
    option: SharedModifierOption,
    override: ItemModifierGroupLink["optionOverrides"][number] | null,
  ) {
    if (!canWrite || busyKey) return;
    if (link.modifierGroupId.startsWith("new-group-") || option.id.startsWith("new-option-")) {
      setActionError("Save this item before hiding options from a newly created add-on set.");
      return;
    }

    const now = new Date().toISOString();
    const hidden = override?.isHidden ?? false;
    const nextHidden = !hidden;
    const links = item.modifierGroupLinks ?? [];

    onChangeLinks(
      links.map((candidate) => {
        if (candidate.id !== link.id) return candidate;
        const overrides = candidate.optionOverrides ?? [];
        const existing = overrides.find(
          (candidateOverride) => candidateOverride.modifierOptionId === option.id,
        );

        if (!existing) {
          return {
            ...candidate,
            updatedAt: now,
            optionOverrides: [
              ...overrides,
              {
                id: makeDraftId("new-override"),
                menuItemModifierGroupId: candidate.id,
                modifierOptionId: option.id,
                isHidden: true,
                priceDeltaOverride: null,
                sortOrderOverride: null,
                createdAt: now,
                updatedAt: now,
                modifierOption: option,
              },
            ],
          };
        }

        const updated = {
          ...existing,
          isHidden: nextHidden,
          updatedAt: now,
        };
        const shouldClearOverride =
          !updated.isHidden &&
          updated.priceDeltaOverride == null &&
          updated.sortOrderOverride == null;
        return {
          ...candidate,
          updatedAt: now,
          optionOverrides: shouldClearOverride
            ? overrides.filter(
                (candidateOverride) => candidateOverride.modifierOptionId !== option.id,
              )
            : overrides.map((candidateOverride) =>
                candidateOverride.modifierOptionId === option.id
                  ? updated
                  : candidateOverride,
              ),
        };
      }),
    );
    setActionError(null);
  }

  const quickQuantityInvalid =
    quickStockMode === "QUANTITY" && parseQuantityInput(quickStockQty) == null;

  return (
    <section className="rounded-2xl border border-stone-200 bg-stone-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-black uppercase tracking-widest text-stone-700">
            Add-on sets
          </div>
          <div className="mt-1 text-xs font-bold text-stone-500">
            Add-on sets attached to this item.
          </div>
        </div>
        {onOpenLibrary && (
          <button
            type="button"
            onClick={() => void onOpenLibrary()}
            disabled={!canWrite || busyKey != null}
            aria-haspopup="dialog"
            className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-800 hover:border-stone-400 disabled:opacity-50"
          >
            <SlidersHorizontal size={12} strokeWidth={2.5} aria-hidden />
            Manage Add-ons
          </button>
        )}
      </div>
      <div className="mt-3 rounded-xl border border-stone-200 bg-white px-3 py-2 text-xs font-bold leading-relaxed text-stone-600">
        Hide removes an option from this item only. To delete an option from the
        add-on set, manage Add-ons and edit the set.
      </div>

      <form
        className={`mt-4 grid items-stretch gap-2 rounded-2xl border border-yellow-200 bg-yellow-50/40 p-3 ${
          quickStockMode === "QUANTITY"
            ? "lg:grid-cols-[minmax(16rem,1fr)_7.5rem_minmax(11rem,13rem)_7rem_8rem]"
            : "lg:grid-cols-[minmax(16rem,1fr)_7.5rem_minmax(11rem,13rem)_8rem]"
        }`}
        onSubmit={handleQuickCreate}
      >
        <input
          value={quickName}
          onChange={(event) => {
            setQuickName(event.target.value);
            setQuickError(null);
          }}
          disabled={!canWrite || busyKey != null}
          className={INPUT_CLS}
          style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
          placeholder="New add-on"
          aria-label="New add-on name"
        />
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-xs font-black text-stone-500">
            $
          </span>
          <input
            value={quickPrice}
            onChange={(event) => {
              setQuickPrice(event.target.value);
              setQuickError(null);
            }}
            disabled={!canWrite || busyKey != null}
            className={`${INPUT_CLS} pl-7`}
            style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
            placeholder="0.00"
            inputMode="decimal"
            aria-label="New add-on price"
          />
        </div>
        <select
          value={quickStockMode}
          onChange={(event) => {
            const nextMode = event.target.value as OptionStockMode;
            setQuickStockMode(nextMode);
            if (nextMode === "MANUAL") setQuickStockQty("0");
            setQuickError(null);
          }}
          disabled={!canWrite || busyKey != null}
          className={INPUT_CLS}
          style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
          aria-label="New add-on stock mode"
        >
          <option value="MANUAL">Manual</option>
          <option value="QUANTITY">Track quantity</option>
        </select>
        {quickStockMode === "QUANTITY" && (
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] font-black uppercase tracking-widest text-stone-500">
              Qty
            </span>
            <input
              value={quickStockQty}
              onChange={(event) => {
                setQuickStockQty(event.target.value);
                setQuickError(null);
              }}
              disabled={!canWrite || busyKey != null}
              className={`${INPUT_CLS} pl-12`}
              style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
              placeholder="0"
              inputMode="numeric"
              aria-label="New add-on quantity"
            />
          </div>
        )}
        <button
          type="submit"
          disabled={
            !canWrite ||
            !quickName.trim() ||
            (!quickExistingNameMatch && quickQuantityInvalid) ||
            busyKey != null
          }
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-stone-950 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-yellow-300 disabled:opacity-50"
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden />
          Add
        </button>
        {quickSuggestions.length > 0 && (
          <div className="w-full space-y-2 rounded-xl border border-stone-200 bg-white p-2">
            <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
              Existing add-on sets
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {quickSuggestions.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => {
                    attachExistingGroup(group);
                    setQuickName("");
                    setQuickPrice("0");
                    setQuickStockMode("QUANTITY");
                    setQuickStockQty("0");
                    setQuickError(null);
                  }}
                  disabled={!canWrite || busyKey != null}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-left hover:border-stone-400 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-black text-stone-950">
                      {group.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] font-bold text-stone-500">
                      {selectionLabel(group.selectionMode)} · {activeOptionSummary(group)}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-full bg-stone-950 px-2.5 py-1 text-[9px] font-black uppercase tracking-widest text-yellow-300">
                    Use
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
        {quickError && (
          <div className="w-full text-xs font-bold text-red-700">
            {quickError}
          </div>
        )}
      </form>

      <div
        className="my-3 flex items-center gap-3"
        data-testid="workspace-item-addon-or-divider"
      >
        <span className="h-px flex-1 bg-stone-200" />
        <span className="text-[10px] font-black uppercase tracking-widest text-stone-400">
          or
        </span>
        <span className="h-px flex-1 bg-stone-200" />
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
        <select
          value={selectedGroupId}
          onChange={(event) => setSelectedGroupId(event.target.value)}
          disabled={!canWrite || availableGroups.length === 0 || busyKey != null}
          className={INPUT_CLS}
          style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
          aria-label="Attach add-on set"
        >
          <option value="">
            {availableGroups.length > 0
              ? "Choose an add-on set"
              : "No add-on sets available"}
          </option>
          {availableGroups.map((group) => (
            <option key={group.id} value={group.id}>
              {group.name} ({group.options.filter((option) => option.isActive).length})
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={handleAttach}
          disabled={!canWrite || !selectedGroupId || busyKey != null}
          className="inline-flex items-center justify-center gap-2 rounded-full bg-stone-950 px-4 py-2.5 text-[11px] font-black uppercase tracking-widest text-yellow-300 disabled:opacity-50"
        >
          <Plus size={14} strokeWidth={2.5} aria-hidden />
          Attach
        </button>
      </div>
      {actionError && (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
          {actionError}
        </div>
      )}

      <div className="mt-4 space-y-3">
        {activeLinks.length > 0 ? (
          activeLinks.map((link) => (
            <AttachedGroupCard
              key={link.id}
              link={link}
              busyKey={busyKey}
              canWrite={canWrite}
              onDetachGroup={handleDetach}
              onToggleOptionHidden={handleToggleOptionHidden}
              onManageGroupStock={onOpenLibrary ? handleManageGroupStock : undefined}
            />
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-stone-300 bg-white px-3 py-3 text-sm font-bold text-stone-500">
            No add-on set is attached.
          </div>
        )}
      </div>
    </section>
  );
}

function makeDraftId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function groupMatchesQuery(group: SharedModifierGroup, normalizedQuery: string) {
  if (normalizeName(group.name).includes(normalizedQuery)) return true;
  return group.options.some((option) =>
    normalizeName(option.name).includes(normalizedQuery),
  );
}

function activeOptionSummary(group: SharedModifierGroup) {
  const activeOptions = group.options.filter((option) => option.isActive);
  if (activeOptions.length === 0) return "no active options";
  if (activeOptions.length === 1) {
    const option = activeOptions[0];
    return `${option.name} ${formatCurrency(option.priceDelta)}`;
  }
  return `${activeOptions.length} options`;
}

function optionOverrideForLink(
  link: ItemModifierGroupLink,
  option: SharedModifierOption,
) {
  return (
    link.optionOverrides.find(
      (candidate) => candidate.modifierOptionId === option.id,
    ) ?? null
  );
}

function sortedOptionsForLink(link: ItemModifierGroupLink) {
  return [...link.modifierGroup.options].sort((a, b) => {
    const overrideA = optionOverrideForLink(link, a);
    const overrideB = optionOverrideForLink(link, b);
    const sortA = overrideA?.sortOrderOverride ?? a.sortOrder;
    const sortB = overrideB?.sortOrderOverride ?? b.sortOrder;
    return sortA - sortB || a.name.localeCompare(b.name);
  });
}

function visibleActiveOptionsForLink(link: ItemModifierGroupLink) {
  return sortedOptionsForLink(link).filter((option) => {
    const override = optionOverrideForLink(link, option);
    return option.isActive && !(override?.isHidden ?? false);
  });
}

function parsePriceInput(raw: string): number | null {
  const cleaned = raw.trim().replace(/^\$/, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 100) / 100;
}

function parseQuantityInput(raw: string): number | null {
  const cleaned = raw.trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function AttachedGroupCard({
  link,
  busyKey,
  canWrite,
  onDetachGroup,
  onToggleOptionHidden,
  onManageGroupStock,
}: {
  link: ItemModifierGroupLink;
  busyKey: string | null;
  canWrite: boolean;
  onDetachGroup: (link: ItemModifierGroupLink) => void;
  onToggleOptionHidden: (
    link: ItemModifierGroupLink,
    option: SharedModifierOption,
    override: ItemModifierGroupLink["optionOverrides"][number] | null,
  ) => void;
  onManageGroupStock?: (link: ItemModifierGroupLink) => void;
}) {
  const group = link.modifierGroup;
  const sortedOptions = sortedOptionsForLink(link);

  return (
    // Set card — recommended preset from
    // docs/proposal/edit-item-modal-addon-set-header-distinction.html
    // (subtle): set header gets a stone-100 band with a bottom border;
    // option rows below stay white. Outer p-3 removed so the header tint
    // can run edge-to-edge inside the card.
    <div
      className="overflow-hidden rounded-2xl border border-stone-200 bg-white"
      data-testid="workspace-item-addon-set-card"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 bg-stone-100 p-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              // White icon chip — replaces soft-yellow background so the
              // link icon stays legible against the stone-100 header band.
              className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-900"
              aria-hidden
            >
              <Link2 size={15} strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-sm font-black text-stone-950">
                {group.name}
              </div>
              <div className="mt-0.5 text-[11px] font-bold text-stone-500">
                {selectionLabel(group.selectionMode)} - {ruleLabel(link)}
              </div>
            </div>
          </div>
          {group.description && (
            <p className="mt-2 text-xs font-semibold leading-relaxed text-stone-500">
              <span className="font-black uppercase tracking-widest text-stone-500">
                Internal note:
              </span>{" "}
              {group.description}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {!group.isActive && (
            <span className="rounded-full border border-stone-200 bg-stone-100 px-2 py-1 text-[10px] font-black uppercase tracking-widest text-stone-500">
              Group inactive
            </span>
          )}
          {onManageGroupStock && (
            <button
              type="button"
              onClick={() => onManageGroupStock(link)}
              disabled={!canWrite || busyKey != null}
              className="inline-flex items-center gap-1.5 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-700 disabled:opacity-50"
              title="Open this add-on set to manage option stock."
              data-testid="workspace-item-addon-set-manage-stock"
            >
              <SlidersHorizontal size={12} strokeWidth={2.5} aria-hidden />
              Manage stock
            </button>
          )}
          <button
            type="button"
            onClick={() => onDetachGroup(link)}
            disabled={!canWrite || busyKey != null}
            className="inline-flex items-center gap-1.5 rounded-full border border-red-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-red-700 disabled:opacity-50"
          >
            <Trash2 size={12} strokeWidth={2.5} aria-hidden />
            Detach
          </button>
        </div>
      </div>

      <div className="space-y-2 p-3">
        {sortedOptions.length > 0 ? (
          sortedOptions.map((option) => {
            const override = optionOverrideForLink(link, option);
            return (
              <OptionSummaryRow
                key={option.id}
                option={option}
                override={override ?? null}
                link={link}
                busyKey={busyKey}
                canWrite={canWrite}
                onToggleHidden={onToggleOptionHidden}
              />
            );
          })
        ) : (
          <div className="rounded-xl border border-dashed border-stone-200 bg-stone-50 px-3 py-2 text-xs font-bold text-stone-400">
            No options in this add-on set.
          </div>
        )}
      </div>
    </div>
  );
}

function OptionSummaryRow({
  option,
  override,
  link,
  busyKey,
  canWrite,
  onToggleHidden,
}: {
  option: SharedModifierOption;
  override: ItemModifierGroupLink["optionOverrides"][number] | null;
  link: ItemModifierGroupLink;
  busyKey: string | null;
  canWrite: boolean;
  onToggleHidden: (
    link: ItemModifierGroupLink,
    option: SharedModifierOption,
    override: ItemModifierGroupLink["optionOverrides"][number] | null,
  ) => void;
}) {
  const inheritedPrice = option.priceDelta;
  const effectivePrice = override?.priceDeltaOverride ?? inheritedPrice;
  const hidden = override?.isHidden ?? false;
  const stockBadge = getOptionStockBadge(option);
  const muted = hidden || !option.isActive;

  return (
    <div
      // Background stays white whether muted or not — the grey tint
      // previously applied to hidden/inactive options collided visually
      // with the new stone-100 set-header band (operators confused
      // hidden options with section headers). Hidden state is already
      // conveyed by the "HIDDEN HERE" red badge, the SHOW button (vs
      // HIDE), and the muted text color. A slightly darker border on
      // muted rows preserves a subtle visual cue without re-introducing
      // the misleading grey panel.
      className={`flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2 ${
        muted ? "border-stone-200" : "border-stone-100"
      }`}
      data-testid="workspace-item-addon-set-option-row"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`truncate text-sm font-black ${
              muted ? "text-stone-500" : "text-stone-900"
            }`}
          >
            {option.name}
          </span>
          {stockBadge && (
            <span
              className={`rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-widest ${stockBadge.className}`}
              title={stockBadge.title}
            >
              {stockBadge.label}
            </span>
          )}
          {!option.isActive && (
            <span className="rounded-full border border-stone-200 bg-stone-100 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-stone-500">
              Hidden
            </span>
          )}
          {hidden && (
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-red-700">
              Hidden here
            </span>
          )}
          {override?.priceDeltaOverride != null && (
            <span className="rounded-full border border-yellow-200 bg-yellow-50 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-stone-700">
              Custom price
            </span>
          )}
        </div>
        {override?.priceDeltaOverride != null && (
          <div className="mt-0.5 text-[11px] font-bold text-stone-500">
            Set price {formatCurrency(inheritedPrice)}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <div
          className={`font-mono text-sm font-black ${
            muted ? "text-stone-400" : "text-stone-700"
          }`}
        >
          {formatCurrency(effectivePrice)}
        </div>
        <button
          type="button"
          onClick={() => onToggleHidden(link, option, override)}
          disabled={!canWrite || busyKey != null}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-black uppercase tracking-widest disabled:opacity-50 ${
            hidden
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-stone-200 bg-white text-stone-700"
          }`}
          title={
            hidden
              ? "Show this option again for this item"
              : "Hide this option from this item only. Use Manage Add-ons to delete it from the set."
          }
        >
          {hidden ? (
            <Eye size={11} strokeWidth={2.5} aria-hidden />
          ) : (
            <EyeOff size={11} strokeWidth={2.5} aria-hidden />
          )}
          {hidden ? "Show" : "Hide"}
        </button>
      </div>
    </div>
  );
}

function getOptionStockBadge(option: SharedModifierOption) {
  if (option.stockMode !== "QUANTITY" && !option.isOutOfStock) return null;

  const label = optionStockLabel(option);
  const isQuantity = option.stockMode === "QUANTITY";
  const qty = option.stockQty ?? 0;
  const className =
    isQuantity && qty <= 0
      ? "border-red-200 bg-red-50 text-red-800"
      : isOptionLowStock(option)
        ? "border-amber-200 bg-amber-50 text-amber-900"
        : isQuantity
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-red-200 bg-red-50 text-red-800";

  return {
    label,
    className,
    title: isQuantity ? `Quantity stock: ${label}` : `Manual stock: ${label}`,
  };
}

function selectionLabel(selectionMode: SharedModifierSelectionMode) {
  if (selectionMode === "REQUIRED_SINGLE") return "Required single";
  if (selectionMode === "OPTIONAL_SINGLE") return "Optional single";
  if (selectionMode === "REQUIRED_MULTI") return "Required multi";
  return "Optional multi";
}

function ruleLabel(link: ItemModifierGroupLink) {
  const min = link.minSelectOverride ?? link.modifierGroup.minSelect;
  const max = link.maxSelectOverride ?? link.modifierGroup.maxSelect;
  if (max == null) return `choose ${min}+`;
  if (min === max) return `choose ${min}`;
  return `choose ${min}-${max}`;
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}
