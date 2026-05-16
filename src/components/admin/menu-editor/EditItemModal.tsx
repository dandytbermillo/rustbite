"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronsDown, ChevronsUp, Eye, EyeOff } from "lucide-react";
import {
  ACCEPTED_IMAGE_CONTENT_TYPES,
  MAX_IMAGE_UPLOAD_BYTES,
} from "@/lib/image-upload-constraints";
import { BRAND } from "@/lib/brand";
import ModalShell from "./ModalShell";
import VisibilityRow from "./VisibilityRow";
import HeroImageUpload from "./HeroImageUpload";
import SizesEditor from "./SizesEditor";
import AddonsEditor from "./AddonsEditor";
import SharedModifiersWorkspacePanel from "./SharedModifiersWorkspacePanel";
import KioskItemPreview from "./KioskItemPreview";
import type {
  EditModalSharedProps,
  HeroPending,
  Item,
  SharedModifierGroup,
} from "./types";
import { ADMIN_MENU_BADGES } from "@/lib/menu-admin";

type Props = EditModalSharedProps;

const ITEM_FORM_SECTIONS = [
  { id: "basics", label: "Basics" },
  { id: "inventory", label: "Inventory" },
  { id: "sizes", label: "Sizes" },
  { id: "addons", label: "Add-on sets" },
  { id: "appearance", label: "Appearance" },
  { id: "image", label: "Image" },
] as const;

type ItemFormSectionId = (typeof ITEM_FORM_SECTIONS)[number]["id"];

const COLLAPSED_FOR_EXISTING_ITEM = new Set<ItemFormSectionId>([
  "basics",
  "inventory",
  "sizes",
  "addons",
  "appearance",
  "image",
]);

function mergeSharedModifierGroupsIntoItem(
  item: Item,
  groups: SharedModifierGroup[],
): Item {
  const links = item.modifierGroupLinks ?? [];
  if (links.length === 0 || groups.length === 0) return item;

  const groupsById = new Map(groups.map((group) => [group.id, group]));
  let changed = false;
  const modifierGroupLinks = links.map((link) => {
    const latestGroup = groupsById.get(link.modifierGroupId);
    if (!latestGroup) return link;
    if (
      link.modifierGroup.lockVersion === latestGroup.lockVersion &&
      link.modifierGroup.updatedAt === latestGroup.updatedAt
    ) {
      return link;
    }

    changed = true;
    const latestOptionsById = new Map(
      latestGroup.options.map((option) => [option.id, option]),
    );
    return {
      ...link,
      modifierGroup: latestGroup,
      optionOverrides: link.optionOverrides.map((override) => {
        const latestOption = latestOptionsById.get(override.modifierOptionId);
        return latestOption
          ? { ...override, modifierOption: latestOption }
          : override;
      }),
    };
  });

  return changed ? { ...item, modifierGroupLinks } : item;
}

// Non-deal item modal. Composes the form sections + sticky kiosk preview.
// Deal-specific UI lives in EditDealModal; routing should pick the right one
// based on the item's category.
export default function EditItemModal(props: Props) {
  const {
    mode,
    item,
    categories,
    onCancel,
    onSave,
    onHide,
    onDelete,
    onHardDelete,
    saving,
    busyDeleting,
    canWriteMenu,
    sharedModifiers,
  } = props;

  const [draft, setDraft] = useState<Item>(item);
  const [persistedItem, setPersistedItem] = useState<Item>(item);
  const [heroPending, setHeroPending] = useState<HeroPending>({ heroFile: null, removeHero: false });
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflictMsg, setConflictMsg] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(true);
  const sectionRefs = useRef<
    Partial<Record<ItemFormSectionId, HTMLElement | null>>
  >({});
  const [selectedSectionId, setSelectedSectionId] =
    useState<ItemFormSectionId | null>(null);
  const [collapsedSections, setCollapsedSections] = useState<
    Set<ItemFormSectionId>
  >(() =>
    mode === "edit" ? new Set(COLLAPSED_FOR_EXISTING_ITEM) : new Set(),
  );

  // Mirror MenuEditor.tsx: keep a blob URL for hero preview, revoke on swap/unmount.
  useEffect(() => {
    setDraft(item);
    setPersistedItem(item);
    setHeroPending({ heroFile: null, removeHero: false });
    setError(null);
    setConflictMsg(null);
    setSelectedSectionId(null);
    setCollapsedSections(
      mode === "edit" ? new Set(COLLAPSED_FOR_EXISTING_ITEM) : new Set(),
    );
  }, [item.id, mode]);

  useEffect(() => {
    const groups = sharedModifiers?.groups ?? [];
    if (groups.length === 0) return;
    setDraft((current) => mergeSharedModifierGroupsIntoItem(current, groups));
    setPersistedItem((current) =>
      mergeSharedModifierGroupsIntoItem(current, groups),
    );
  }, [sharedModifiers?.groups]);

  // Mirror MenuEditor.tsx: keep a blob URL for hero preview, revoke on swap/unmount.
  useEffect(() => {
    if (!heroPending.heroFile) {
      setPreviewBlobUrl(null);
      return;
    }
    const url = URL.createObjectURL(heroPending.heroFile);
    setPreviewBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [heroPending.heroFile]);

  // Reset confirm-delete after 3s.
  useEffect(() => {
    if (!confirmingDelete) return;
    const t = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(t);
  }, [confirmingDelete]);

  // ⌘/Ctrl+S to save, Esc handled by ModalShell.
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
  }, [draft, heroPending]);

  const nameValid = (draft.name ?? "").trim().length > 0;
  const priceValid = Number.isFinite(draft.price) && draft.price >= 0;
  const quantityTracked = draft.stockMode === "QUANTITY";
  // canSave folds canWriteMenu so the ⌘/Ctrl+S keyboard path is also gated,
  // not just the visible Save button. Read-only users (in the unlikely event
  // the modal is reachable through some path) can't save by keyboard either.
  const canSave = !saving && nameValid && priceValid && canWriteMenu;
  const dirty =
    JSON.stringify(draft) !== JSON.stringify(persistedItem) ||
    !!heroPending.heroFile ||
    heroPending.removeHero;
  const invalidSectionIds = useMemo(() => {
    const invalid = new Set<ItemFormSectionId>();
    if (!nameValid || !priceValid) invalid.add("basics");
    return invalid;
  }, [nameValid, priceValid]);

  useEffect(() => {
    if (invalidSectionIds.has("basics")) {
      setCollapsedSections((current) => {
        if (!current.has("basics")) return current;
        const next = new Set(current);
        next.delete("basics");
        return next;
      });
    }
  }, [invalidSectionIds]);

  const sizeSummary = useMemo(() => {
    if (draft.sizes.length === 0) return "No sizes";
    const details = draft.sizes.map((size) => {
      const name = size.name.trim() || "Untitled";
      return `${name} ${formatSizePriceDelta(size.priceDelta)}`;
    });
    return `${draft.sizes.length} size${draft.sizes.length !== 1 ? "s" : ""} · ${details.join(" · ")}`;
  }, [draft.sizes]);
  const basicsSummary = useMemo(() => {
    const category = categories.find((c) => c.id === draft.categoryId);
    const parts = [
      category ? `${category.icon} ${category.name}` : null,
      draft.name.trim() || "Untitled",
      `$${draft.price.toFixed(2)}`,
    ].filter(Boolean);
    return parts.join(" · ");
  }, [categories, draft.categoryId, draft.name, draft.price]);
  const addOnsSummary = useMemo(() => {
    if (sharedModifiers) {
      const names = (draft.modifierGroupLinks ?? [])
        .filter((link) => link.isActive)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((link) => link.modifierGroup.name.trim() || "Untitled");
      if (names.length === 0) return "No add-on sets";
      return `${names.length} add-on set${names.length !== 1 ? "s" : ""} · ${names.join(" · ")}`;
    }
    if (draft.addons.length === 0) return "No item-specific add-ons";
    const names = draft.addons
      .map((addon) => addon.name.trim() || "Untitled")
      .slice(0, 4);
    const suffix = draft.addons.length > names.length ? ` · +${draft.addons.length - names.length} more` : "";
    return `${draft.addons.length} item-specific add-on${draft.addons.length !== 1 ? "s" : ""} · ${names.join(" · ")}${suffix}`;
  }, [draft.addons, draft.modifierGroupLinks, sharedModifiers]);
  const allCollapsibleSectionsCollapsed = useMemo(
    () =>
      ITEM_FORM_SECTIONS.every(
        (section) =>
          invalidSectionIds.has(section.id) ||
          collapsedSections.has(section.id),
      ),
    [collapsedSections, invalidSectionIds],
  );

  function setSectionRef(id: ItemFormSectionId, node: HTMLElement | null) {
    sectionRefs.current[id] = node;
  }

  function toggleSection(id: ItemFormSectionId) {
    setCollapsedSections((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function scrollToSection(id: ItemFormSectionId) {
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
        ITEM_FORM_SECTIONS
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

  function handleCancel() {
    if (
      dirty &&
      !window.confirm("Discard unsaved item changes? Your changes will not be saved.")
    ) {
      return;
    }
    onCancel();
  }

  async function handleSave() {
    if (!canSave) return;
    setError(null);
    setConflictMsg(null);
    const result = await onSave(draft, heroPending);
    if (!result.ok) {
      if (result.conflict) {
        setConflictMsg(result.error);
      } else {
        setError(result.error);
      }
      return;
    }
    setPersistedItem(result.item);
    setDraft(result.item);
  }

  function handleDelete() {
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }
    setConfirmingDelete(false);
    void onDelete();
  }

  async function handleVisibilityAction() {
    const updated = await onHide();
    if (updated) {
      setDraft((d) => ({
        ...d,
        isActive: updated.isActive,
        lockVersion: updated.lockVersion,
        updatedAt: updated.updatedAt,
      }));
      setPersistedItem((d) => ({
        ...d,
        isActive: updated.isActive,
        lockVersion: updated.lockVersion,
        updatedAt: updated.updatedAt,
      }));
    }
  }

  function updateStockMode(stockMode: Item["stockMode"]) {
    if (stockMode === "QUANTITY") {
      setDraft({
        ...draft,
        stockMode,
        stockQty: draft.stockQty ?? 0,
        lowStockThreshold: draft.lowStockThreshold ?? null,
      });
      return;
    }

    setDraft({
      ...draft,
      stockMode,
    });
  }

  function updateStockQty(raw: string) {
    setDraft({
      ...draft,
      stockQty: parseNonNegativeInteger(raw, 0),
    });
  }

  function updateLowStockThreshold(raw: string) {
    setDraft({
      ...draft,
      lowStockThreshold: raw.trim() === "" ? null : parseNonNegativeInteger(raw, 0),
    });
  }

  return (
    <ModalShell
      ariaLabel={`${mode === "edit" ? "Edit" : "Create"} item`}
      maxWidthClassName="max-w-[1600px]"
      bodyClassName="flex-1 min-h-0 overflow-y-auto xl:flex xl:overflow-hidden"
      onClose={handleCancel}
      titleNode={
        <h2
          className="flex items-center gap-2.5 truncate"
          style={{ fontFamily: "Archivo Black", letterSpacing: "-0.02em" }}
        >
          {(() => {
            const activeCategory = categories.find(
              (c) => c.id === draft.categoryId,
            );
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
            <span className="truncate">{draft.name || "Untitled"}</span>
          </span>
        </h2>
      }
      body={(
        <div className="flex min-h-full flex-col gap-5 px-8 pb-6 pt-0 xl:min-h-0 xl:flex-1 xl:flex-row xl:overflow-hidden">
          {/* LEFT: form */}
          <div
            className="min-w-0 xl:max-h-full xl:flex-[1_1_0] xl:self-start xl:overflow-x-hidden xl:overflow-y-auto xl:overscroll-contain xl:pr-3"
            data-testid="item-editor-detail-scroll"
            style={{ scrollbarGutter: "stable" } as React.CSSProperties}
          >
            <SectionJumpNav
              sections={ITEM_FORM_SECTIONS}
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

              <EditorSection
                id="basics"
                title="Basics"
                selected={selectedSectionId === "basics"}
                hasError={invalidSectionIds.has("basics")}
                collapsed={collapsedSections.has("basics")}
                onToggle={() => toggleSection("basics")}
                sectionRef={(node) => setSectionRef("basics", node)}
                summary={basicsSummary}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
                  <Field label="Category" required>
                    <select
                      value={draft.categoryId}
                      onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}
                      className={SELECT_CLS}
                      style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                    >
                      {/* For non-deal create flows (fresh and duplicate alike),
                          filter out the Deals category — Deals have their own
                          creation path (+ ADD NEW DEAL → DealBasePickerModal).
                          Letting a normal item-create modal switch INTO Deals
                          only produces a server-rejected dead end. The current
                          category stays selectable in edit mode so existing
                          items in any category remain editable. */}
                      {categories
                        .filter((c) =>
                          mode === "edit" || c.slug !== "deals",
                        )
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.icon} {c.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Name" required error={!nameValid ? "Name is required." : undefined}>
                    <input
                      type="text"
                      data-modal-autofocus
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      maxLength={60}
                      className={INPUT_CLS}
                      style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                    />
                  </Field>
                  <Field label="Base price" required error={!priceValid ? "Must be 0 or greater." : undefined}>
                    <PrefixInput
                      prefix="$"
                      type="number"
                      min={0}
                      step={0.01}
                      value={draft.price}
                      onChange={(v) => setDraft({ ...draft, price: parseFloat(v) || 0 })}
                    />
                  </Field>
                </div>
                <div className="mt-3.5">
                  <Field label="Description">
                    <textarea
                      value={draft.description}
                      onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                      maxLength={160}
                      rows={1}
                      className={`${INPUT_CLS} min-h-[48px] resize-y leading-relaxed`}
                      style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                    />
                    <Help>
                      {draft.description.length} / 160 characters · shown under the item name.
                    </Help>
                  </Field>
                </div>
                <p className="mt-2.5 text-xs text-stone-500">
                  Sort order is set by drag-and-drop on the menu list page, not here.
                </p>
              </EditorSection>

              <EditorSection
                id="inventory"
                title="Inventory"
                selected={selectedSectionId === "inventory"}
                collapsed={collapsedSections.has("inventory")}
                onToggle={() => toggleSection("inventory")}
                sectionRef={(node) => setSectionRef("inventory", node)}
                summary={
                  quantityTracked
                    ? draft.isOutOfStock
                      ? `Paused · ${draft.stockQty ?? 0} saved`
                      : `${draft.stockQty ?? 0} left`
                    : draft.isOutOfStock
                      ? "Paused"
                      : "Manual in stock"
                }
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                  <Field label="Stock mode" required>
                    <select
                      value={draft.stockMode}
                      onChange={(e) => updateStockMode(e.target.value as Item["stockMode"])}
                      className={SELECT_CLS}
                      style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                    >
                      <option value="MANUAL">Manual in / out</option>
                      <option value="QUANTITY">Track quantity</option>
                    </select>
                    <Help>
                      Manual keeps the current in/out switch. Quantity makes availability come from units on hand.
                    </Help>
                  </Field>

                  {quantityTracked && (
                    <>
                      <Field label="Quantity on hand" required>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={draft.stockQty ?? 0}
                          onChange={(e) => updateStockQty(e.target.value)}
                          className={`${INPUT_CLS} font-mono`}
                          style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                        />
                        <Help>0 means out of stock on kiosk, deals, and stock filters.</Help>
                      </Field>
                      <Field label="Low stock alert" optional>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={draft.lowStockThreshold ?? ""}
                          placeholder="Optional"
                          onChange={(e) => updateLowStockThreshold(e.target.value)}
                          className={`${INPUT_CLS} font-mono`}
                          style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                        />
                        <Help>
                          Used for admin warnings. Quantity stock is decremented when an order is
                          accepted.
                        </Help>
                      </Field>
                    </>
                  )}
                </div>
                <div className="mt-4">
                  <VisibilityRow
                    isActive={draft.isActive}
                    isOutOfStock={draft.isOutOfStock}
                    onIsActiveChange={(v) => setDraft({ ...draft, isActive: v })}
                    onOutOfStockChange={(v) => setDraft({ ...draft, isOutOfStock: v })}
                    omitLiveToggle={mode === "edit"}
                    liveControlLabel="Kiosk visibility"
                    stockControlLabel="Ordering availability"
                    stockLabel={
                      quantityTracked
                        ? draft.isOutOfStock
                          ? "Resume selling"
                          : "Pause selling"
                        : undefined
                    }
                    stockAriaLabel={
                      quantityTracked
                        ? draft.isOutOfStock
                          ? "Resume selling"
                          : "Pause selling"
                        : undefined
                    }
                    canWrite={canWriteMenu}
                    stockHelp={
                      quantityTracked ? (
                        <>
                          <strong className="text-stone-700">Pause selling</strong> makes this item
                          unavailable to order while keeping the saved quantity. Use quantity 0 only
                          when inventory is actually sold out.
                        </>
                      ) : undefined
                    }
                  />
                </div>
              </EditorSection>

              <EditorSection
                id="sizes"
                title="Sizes"
                selected={selectedSectionId === "sizes"}
                collapsed={collapsedSections.has("sizes")}
                onToggle={() => toggleSection("sizes")}
                sectionRef={(node) => setSectionRef("sizes", node)}
                summary={sizeSummary}
              >
                <SizesEditor
                  sizes={draft.sizes}
                  onChange={(sizes) => setDraft({ ...draft, sizes })}
                />
              </EditorSection>

              <EditorSection
                id="addons"
                title="Add-on sets"
                selected={selectedSectionId === "addons"}
                collapsed={collapsedSections.has("addons")}
                onToggle={() => toggleSection("addons")}
                sectionRef={(node) => setSectionRef("addons", node)}
                summary={addOnsSummary}
              >
                {sharedModifiers ? (
                  <SharedModifiersWorkspacePanel
                    item={draft}
                    groups={sharedModifiers.groups}
                    busyKey={sharedModifiers.busyKey}
                    canWrite={canWriteMenu}
                    onOpenLibrary={sharedModifiers.onOpenLibrary}
                    onChangeLinks={(modifierGroupLinks) =>
                      setDraft({ ...draft, modifierGroupLinks })
                    }
                  />
                ) : (
                  <AddonsEditor
                    addons={draft.addons}
                    onChange={(addons) => setDraft({ ...draft, addons })}
                  />
                )}
              </EditorSection>

              <EditorSection
                id="appearance"
                title="Appearance"
                selected={selectedSectionId === "appearance"}
                collapsed={collapsedSections.has("appearance")}
                onToggle={() => toggleSection("appearance")}
                sectionRef={(node) => setSectionRef("appearance", node)}
                summary={[draft.badge, draft.comboNum != null ? `#${draft.comboNum}` : null]
                  .filter(Boolean)
                  .join(" · ") || "Emoji, badge, color"}
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <Field label="Emoji">
                    <input
                      type="text"
                      value={draft.emoji}
                      onChange={(e) => setDraft({ ...draft, emoji: e.target.value })}
                      maxLength={4}
                      className={INPUT_CLS}
                      style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                    />
                    <Help>Fallback when no hero image is uploaded.</Help>
                  </Field>
                  <Field label="Background color">
                    <div className="flex items-center gap-2.5">
                      <span
                        className="w-11 h-11 rounded-xl border border-stone-200 cursor-pointer relative overflow-hidden flex-shrink-0"
                        style={{ background: draft.bgColor }}
                      >
                        <input
                          type="color"
                          value={draft.bgColor}
                          onChange={(e) => setDraft({ ...draft, bgColor: e.target.value })}
                          className="absolute inset-0 opacity-0 cursor-pointer"
                          aria-label="Pick background color"
                        />
                      </span>
                      <input
                        type="text"
                        value={draft.bgColor}
                        onChange={(e) => setDraft({ ...draft, bgColor: e.target.value })}
                        maxLength={7}
                        className={`${INPUT_CLS} font-mono`}
                        style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                      />
                    </div>
                  </Field>
                  <Field label="Badge">
                    <select
                      value={draft.badge ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          badge: (e.target.value || null) as Item["badge"],
                        })
                      }
                      className={SELECT_CLS}
                      style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                    >
                      <option value="">No badge</option>
                      {ADMIN_MENU_BADGES.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Combo number" optional>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={draft.comboNum ?? ""}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          comboNum: e.target.value === "" ? null : parseInt(e.target.value, 10),
                        })
                      }
                      placeholder="Leave empty if not a combo"
                      className={`${INPUT_CLS} font-mono`}
                      style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
                    />
                    <Help>
                      Customer-visible badge on the menu tile (e.g. &quot;#5&quot;). Leave empty for sides, drinks, and à-la-carte items.
                    </Help>
                  </Field>
                </div>
              </EditorSection>

              <EditorSection
                id="image"
                title="Product image"
                selected={selectedSectionId === "image"}
                collapsed={collapsedSections.has("image")}
                onToggle={() => toggleSection("image")}
                sectionRef={(node) => setSectionRef("image", node)}
                summary={heroPending.heroFile ? "New image selected" : draft.imageUrl ? "Custom image" : "Emoji fallback"}
              >
                <HeroImageUpload
                  imageUrl={draft.imageUrl}
                  imageAlt={draft.imageAlt}
                  imageFit={draft.imageFit}
                  hero={heroPending}
                  onHeroChange={setHeroPending}
                  onAltChange={(v) => setDraft({ ...draft, imageAlt: v || null })}
                  onFitChange={(v) => setDraft({ ...draft, imageFit: v })}
                  maxBytes={MAX_IMAGE_UPLOAD_BYTES}
                  acceptedTypes={ACCEPTED_IMAGE_CONTENT_TYPES}
                  cardPreview={{
                    emoji: draft.emoji,
                    bgColor: draft.bgColor,
                    name: draft.name,
                    description: draft.description,
                    price: draft.price,
                    badge: draft.badge,
                    comboNum: draft.comboNum,
                  }}
                />
              </EditorSection>
            </div>

            {previewVisible && (
              <aside className="self-start xl:w-[380px] xl:shrink-0 2xl:w-[420px]" aria-label="Live kiosk preview">
                <div className="text-[11px] font-black tracking-widest uppercase text-stone-700 mb-2.5">
                  Customers will see this
                </div>
                <KioskItemPreview
                  item={{
                    ...draft,
                    imageUrl: heroPending.removeHero ? null : draft.imageUrl,
                  }}
                  previewImageUrl={previewBlobUrl}
                />
              </aside>
            )}
          </div>
      )}
      footer={
        <>
          {mode === "edit" && canWriteMenu ? (
            <div className="min-w-0">
              <div className="mb-1 text-[10px] font-black uppercase tracking-widest text-red-700">
                Danger zone
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* Destructive controls only apply to existing items.
                    In create mode (including the duplicate-as-draft flow), the
                    draft has a temp id (`new-item`) and these routes have no
                    row to act on. Combined with canWriteMenu, this prevents
                    read-only users (or duplicate-mode operators) from invoking
                    them. */}
                <DangerLink
                  onClick={handleVisibilityAction}
                  disabled={saving || busyDeleting}
                >
                  {draft.isActive ? "Hide item" : "Show item"}
                </DangerLink>
                <DangerLink onClick={handleDelete} confirming={confirmingDelete}>
                  {confirmingDelete ? "Click again to confirm" : "Delete item"}
                </DangerLink>
                {onHardDelete && (
                  <DangerLink onClick={onHardDelete} disabled={busyDeleting}>
                    Hard delete
                  </DangerLink>
                )}
              </div>
            </div>
          ) : (
            <span aria-hidden />
          )}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-xs text-stone-500 font-mono">
              <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded text-[11px]">⌘S</kbd> save ·{" "}
              <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded text-[11px]">Esc</kbd> cancel
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
                style={{ background: BRAND.red, boxShadow: "0 4px 12px rgba(215,38,30,0.25)" }}
              >
                {saving ? "Saving…" : "Save item"}
              </button>
            )}
          </div>
        </>
      }
    />
  );
}

/* ── Local primitives ─────────────────────────────────────────── */

const INPUT_CLS =
  "w-full px-3.5 py-3 rounded-xl border border-stone-200 text-sm bg-white focus:outline-none focus:ring-2 focus:border-stone-900";
const SELECT_CLS = INPUT_CLS;

function SectionJumpNav({
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
  sections: typeof ITEM_FORM_SECTIONS;
  selectedSectionId: ItemFormSectionId | null;
  invalidSectionIds: Set<ItemFormSectionId>;
  onJump: (id: ItemFormSectionId) => void;
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
          aria-label="Item editor sections"
          data-testid="item-editor-section-nav"
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

function EditorSection({
  id,
  title,
  summary,
  selected,
  hasError,
  collapsed,
  onToggle,
  sectionRef,
  children,
}: {
  id: ItemFormSectionId;
  title?: string;
  summary?: string;
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
      id={`item-editor-${id}`}
      data-editor-section={id}
      data-testid={`item-editor-section-${id}`}
      className={`group scroll-mt-24 border-l-4 border-t border-stone-150 py-5 pl-4 transition-colors duration-200 first:border-t-0 first:pt-0 ${
        selected
          ? "border-l-yellow-400"
          : "border-l-transparent hover:border-l-yellow-200"
      }`}
    >
      {title && (
        <button
          type="button"
          onClick={onToggle}
          className="mb-3 flex w-full items-center justify-between gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
          aria-expanded={!collapsed}
          aria-controls={`item-editor-${id}-body`}
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
      )}
      <div
        id={`item-editor-${id}-body`}
        data-testid={`item-editor-section-body-${id}`}
        hidden={collapsed}
      >
        {children}
      </div>
    </section>
  );
}
function Field({
  label,
  required,
  optional,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  optional?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label className="text-[11px] font-black tracking-widest uppercase text-stone-700 flex items-center gap-1.5">
        {label}
        {required && <span style={{ color: BRAND.red }}>*</span>}
        {optional && <span className="text-stone-400 font-medium normal-case text-xs">optional</span>}
      </label>
      {children}
      {error && <div className="text-xs font-bold text-red-600">{error}</div>}
    </div>
  );
}
function Help({ children }: { children: React.ReactNode }) {
  return <p className="mt-1 text-xs text-stone-500 leading-relaxed">{children}</p>;
}
function parseNonNegativeInteger(raw: string, fallback: number): number {
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}
function formatSizePriceDelta(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "included";
  return `+$${value.toFixed(2)}`;
}
function PrefixInput({
  prefix,
  value,
  onChange,
  placeholder,
  type,
  min,
  step,
}: {
  prefix: string;
  value: number | string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  min?: number;
  step?: number;
}) {
  return (
    <div className="relative">
      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-500 font-mono font-bold pointer-events-none">
        {prefix}
      </span>
      <input
        type={type ?? "text"}
        min={min}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`${INPUT_CLS} pl-8 font-mono`}
        style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
      />
    </div>
  );
}
function DangerLink({
  onClick,
  confirming,
  disabled,
  children,
}: {
  onClick: () => void | Promise<void>;
  confirming?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={disabled}
      className="inline-flex min-h-10 items-center justify-center rounded-full border px-4 py-2 text-[11px] font-black uppercase tracking-widest transition-colors disabled:opacity-50"
      style={{
        color: confirming ? "white" : BRAND.red,
        background: confirming ? BRAND.red : "#fff",
        borderColor: confirming ? BRAND.red : "#F5B8B2",
      }}
    >
      {children}
    </button>
  );
}
