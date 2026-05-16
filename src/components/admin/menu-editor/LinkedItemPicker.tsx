"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { lockBodyScroll } from "@/lib/body-scroll-lock";

export type PickerItem = {
  id: string;
  name: string;
  emoji: string;
  bgColor: string;
  description?: string;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  isActive: boolean;
  isOutOfStock: boolean;
  basePrice: number;
  sizes: Array<{ id: string; name: string; priceDelta: number }>;
};

type Props = {
  isOpen: boolean;
  onClose: () => void;
  // All items the parent decides are eligible — parent filters out the
  // current item being edited to prevent self-reference, and already-linked
  // items if it doesn't want duplicates.
  items: PickerItem[];
  // Optional: already-linked menuItemIds to grey out (still selectable to
  // change size, but visually distinct so operators see what's already in).
  alreadyLinkedIds?: string[];
  // Hide inactive items by default; some flows want to allow re-linking
  // to recently-hidden items, so this is configurable.
  includeHidden?: boolean;
  allowNoSizeSelection?: boolean;
  onSelect: (menuItemId: string, sizeId: string | null) => void;
};

// Searchable item picker for upgrade-option linked items. Two-step in-place:
// click an item card → if it has sizes, a size row expands inline; click a
// size → onSelect fires. Items without sizes select immediately.
//
// TODO(wiring):
//  - Replace the in-memory `items` prop with a paginated query if the menu
//    grows past a few hundred items. For now the kiosk menu is small enough
//    that all-in-memory is fine.
//  - Add keyboard navigation (arrow keys, Enter to expand/select, Esc to
//    collapse the inline size row before closing the picker).
export default function LinkedItemPicker({
  isOpen,
  onClose,
  items,
  alreadyLinkedIds = [],
  includeHidden = false,
  allowNoSizeSelection = true,
  onSelect,
}: Props) {
  const [query, setQuery] = useState("");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [showOos, setShowOos] = useState(false);
  const [mounted, setMounted] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Reset on open/close.
  useEffect(() => {
    if (isOpen) {
      setQuery("");
      setExpandedItemId(null);
      // Focus the search field on open.
      setTimeout(() => searchInputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  // Body scroll lock — keyed only on `isOpen` so it acquires the lock once
  // when the picker opens and releases once when it closes. Uses the shared
  // ref-counted lock so stacking with the parent modal is safe.
  useEffect(() => {
    if (!isOpen) return;
    return lockBodyScroll();
  }, [isOpen]);

  // Esc handler. Re-binds when the inner state (`expandedItemId`) or
  // `onClose` ref changes; this is cheap and doesn't touch body.overflow.
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (expandedItemId) setExpandedItemId(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, expandedItemId, onClose]);

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = items.filter((item) => {
      if (!includeHidden && !item.isActive) return false;
      if (!showOos && item.isOutOfStock) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.categoryName.toLowerCase().includes(q) ||
        (item.description ?? "").toLowerCase().includes(q)
      );
    });
    const map = new Map<string, { name: string; icon: string; items: PickerItem[] }>();
    for (const item of filtered) {
      const entry = map.get(item.categoryId) ?? {
        name: item.categoryName,
        icon: item.categoryIcon,
        items: [],
      };
      entry.items.push(item);
      map.set(item.categoryId, entry);
    }
    return [...map.values()];
  }, [items, query, includeHidden, showOos]);

  const totalShown = grouped.reduce((s, g) => s + g.items.length, 0);

  if (!isOpen || !mounted) return null;

  function handleSelect(item: PickerItem, sizeId: string | null) {
    onSelect(item.id, sizeId);
    onClose();
  }

  const picker = (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center p-4"
      style={{ background: "rgba(20,20,20,0.55)" }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Pick a menu item"
        className="w-full max-w-[640px] max-h-[calc(100vh-32px)] flex flex-col bg-white rounded-3xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-stone-100">
          <div className="relative flex-1">
            <Search
              size={16}
              strokeWidth={2.4}
              className="absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none"
            />
            <input
              ref={searchInputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search items, categories…"
              className="w-full pl-10 pr-3.5 py-2.5 rounded-full bg-stone-100 border border-transparent text-sm focus:outline-none focus:ring-2 focus:bg-white focus:border-stone-900"
              style={{ "--tw-ring-color": BRAND.yellow } as React.CSSProperties}
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-9 h-9 inline-flex items-center justify-center rounded-full text-stone-700 hover:bg-stone-100"
          >
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center justify-between gap-2 px-5 py-2.5 border-b border-stone-100 text-xs text-stone-500">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showOos}
              onChange={(e) => setShowOos(e.target.checked)}
              className="w-4 h-4 cursor-pointer"
            />
            <span>Include out-of-stock</span>
          </label>
          <span className="font-mono">
            {totalShown} item{totalShown === 1 ? "" : "s"}
          </span>
        </div>

        {/* List */}
        <div className="flex-1 min-h-0 overflow-y-auto">
          {grouped.length === 0 ? (
            <div className="p-12 text-center text-stone-500 text-sm">
              No matching items.
            </div>
          ) : (
            grouped.map((group) => (
              <div key={group.name} className="border-b border-stone-100 last:border-b-0">
                <div className="px-5 py-2.5 text-[10px] font-black tracking-widest uppercase text-stone-500 bg-stone-50 sticky top-0 z-10">
                  <span className="mr-1.5">{group.icon}</span>
                  {group.name}
                </div>
                <div>
                  {group.items.map((item) => {
                    const isAlreadyLinked = alreadyLinkedIds.includes(item.id);
                    const isExpanded = expandedItemId === item.id;
                    const hasSizes = item.sizes.length > 0;
                    return (
                      <div
                        key={item.id}
                        className={`px-5 py-3 hover:bg-stone-50 transition-colors ${
                          isAlreadyLinked ? "bg-stone-50/60" : ""
                        }`}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (hasSizes) {
                              setExpandedItemId(isExpanded ? null : item.id);
                            } else {
                              handleSelect(item, null);
                            }
                          }}
                          className="w-full flex items-center gap-3.5 text-left"
                        >
                          <div
                            className="w-12 h-12 rounded-xl border border-stone-200 flex items-center justify-center text-2xl flex-shrink-0"
                            style={{ background: item.bgColor || BRAND.cream }}
                          >
                            {item.emoji}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-bold text-stone-900 flex items-center gap-2 flex-wrap">
                              {item.name}
                              {!item.isActive && (
                                <span className="text-[9px] font-black tracking-widest uppercase text-stone-500 bg-stone-200 px-1.5 py-0.5 rounded">
                                  Hidden
                                </span>
                              )}
                              {item.isOutOfStock && (
                                <span
                                  className="text-[9px] font-black tracking-widest uppercase text-white px-1.5 py-0.5 rounded"
                                  style={{ background: BRAND.red }}
                                >
                                  Out of stock
                                </span>
                              )}
                              {isAlreadyLinked && (
                                <span className="text-[9px] font-black tracking-widest uppercase text-stone-700 bg-stone-200 px-1.5 py-0.5 rounded">
                                  Linked
                                </span>
                              )}
                            </div>
                            {item.description && (
                              <div className="text-xs text-stone-500 truncate mt-0.5">
                                {item.description}
                              </div>
                            )}
                          </div>
                          <div className="font-mono text-sm text-stone-700 whitespace-nowrap">
                            ${item.basePrice.toFixed(2)}
                          </div>
                        </button>

                        {/* Inline size row */}
                        {isExpanded && hasSizes && (
                          <div className="mt-2.5 flex flex-wrap gap-2 pl-[60px]">
                            {item.sizes.map((size) => (
                              <button
                                key={size.id}
                                type="button"
                                onClick={() => handleSelect(item, size.id)}
                                className="px-3.5 py-2 rounded-full bg-white border border-stone-200 hover:border-stone-900 text-xs font-bold transition-colors inline-flex items-center gap-2"
                              >
                                <span>{size.name}</span>
                                <span className="text-stone-500 font-mono">
                                  {size.priceDelta === 0 ? "incl." : `+$${size.priceDelta.toFixed(2)}`}
                                </span>
                              </button>
                            ))}
                            {allowNoSizeSelection && (
                              <button
                                type="button"
                                onClick={() => handleSelect(item, null)}
                                className="px-3.5 py-2 rounded-full text-xs font-bold text-stone-500 hover:text-stone-900 inline-flex items-center"
                              >
                                No size
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer hint */}
        <div className="px-5 py-3 text-[11px] text-stone-500 border-t border-stone-100 font-mono">
          <kbd className="px-1.5 py-0.5 bg-stone-100 border border-stone-200 rounded text-[10px]">Esc</kbd>{" "}
          {expandedItemId ? "collapse size row" : "close"}
        </div>
      </div>
    </div>
  );

  return createPortal(picker, document.body);
}
