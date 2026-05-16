"use client";

import { useMemo, useState } from "react";
import { Search, RotateCcw } from "lucide-react";
import { BRAND } from "@/lib/brand";
import { fmt } from "@/lib/pricing";
import type { DealHistoryEntry, DealHistoryStatus } from "@/lib/deal-history";

type HistorySectionKey =
  | "today"
  | "yesterday"
  | "previous7"
  | "previous30"
  | "older";

type HistorySection = {
  key: HistorySectionKey;
  label: string;
  entries: DealHistoryEntry[];
};

type StatusFilter = "all" | DealHistoryStatus;

const HISTORY_SECTIONS: { key: HistorySectionKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "previous7", label: "Previous 7 days" },
  { key: "previous30", label: "Previous 30 days" },
  { key: "older", label: "Older" },
];

const STATUS_FILTERS: Array<{ key: StatusFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "hidden", label: "Hidden" },
  { key: "deleted", label: "Deleted" },
  { key: "historical", label: "Used before" },
  { key: "expired", label: "Expired" },
];

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function historySectionKey(value: string, now: Date): HistorySectionKey {
  const changedAt = new Date(value);
  if (Number.isNaN(changedAt.getTime())) return "older";

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysAgo = Math.floor(
    (startOfLocalDay(now).getTime() - startOfLocalDay(changedAt).getTime()) /
      msPerDay,
  );

  if (daysAgo <= 0) return "today";
  if (daysAgo === 1) return "yesterday";
  if (daysAgo <= 7) return "previous7";
  if (daysAgo <= 30) return "previous30";
  return "older";
}

function formatHistoryTime(value: string, section: HistorySectionKey) {
  const changedAt = new Date(value);
  if (Number.isNaN(changedAt.getTime())) return "Unknown";

  const time = changedAt.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  if (section === "today" || section === "yesterday") return time;

  if (section === "previous7") {
    const weekday = changedAt.toLocaleDateString([], { weekday: "long" });
    return `${weekday}, ${time}`;
  }

  const date = changedAt.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(section === "older" ? { year: "numeric" as const } : {}),
  });
  return `${date}, ${time}`;
}

function groupHistoryEntries(
  entries: DealHistoryEntry[],
  serverNowIso: string,
): HistorySection[] {
  const now = new Date(serverNowIso);
  const safeNow = Number.isNaN(now.getTime()) ? new Date() : now;
  const grouped = new Map<HistorySectionKey, DealHistoryEntry[]>(
    HISTORY_SECTIONS.map((section) => [section.key, []]),
  );

  for (const entry of entries) {
    grouped
      .get(historySectionKey(entry.lastChangedAt, safeNow))!
      .push(entry);
  }

  return HISTORY_SECTIONS.map((section) => ({
    ...section,
    entries: grouped.get(section.key) ?? [],
  })).filter((section) => section.entries.length > 0);
}

function statusLabel(status: DealHistoryStatus) {
  switch (status) {
    case "deleted":
      return "Deleted";
    case "hidden":
      return "Hidden";
    case "expired":
      return "Expired";
    case "historical":
      return "Used before";
  }
}

function statusTone(status: DealHistoryStatus) {
  if (status === "deleted") return "border-red-200 bg-red-50 text-red-800";
  if (status === "expired") return "border-amber-200 bg-amber-50 text-amber-900";
  if (status === "hidden") return "border-stone-200 bg-stone-100 text-stone-700";
  return "border-blue-200 bg-blue-50 text-blue-800";
}

function includedItems(entry: DealHistoryEntry) {
  const links = entry.dealSnapshot.upgradeOptions.flatMap(
    (upgrade) => upgrade.linkedItems,
  );
  const labels = links.map((link) => {
    const itemName = link.itemNameSnapshot ?? "Missing item";
    return link.sizeNameSnapshot ? `${itemName} · ${link.sizeNameSnapshot}` : itemName;
  });

  if (labels.length === 0) return "No included items recorded";
  if (labels.length <= 3) return labels.join(" + ");
  return `${labels.slice(0, 3).join(" + ")} + ${labels.length - 3} more`;
}

function matchesClientFilters(
  entry: DealHistoryEntry,
  query: string,
  status: StatusFilter,
) {
  if (status !== "all" && entry.status !== status) return false;
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) return true;
  return [
    entry.dealSnapshot.name,
    entry.dealSnapshot.description,
    includedItems(entry),
    entry.dealSnapshot.comboNum != null
      ? `combo ${entry.dealSnapshot.comboNum}`
      : "",
  ]
    .join(" ")
    .toLowerCase()
    .includes(trimmed);
}

function statusCounts(entries: DealHistoryEntry[]) {
  const counts: Record<StatusFilter, number> = {
    all: entries.length,
    hidden: 0,
    deleted: 0,
    historical: 0,
    expired: 0,
  };
  for (const entry of entries) counts[entry.status] += 1;
  return counts;
}

export default function DealHistoryBrowser({
  entries,
  serverNowIso,
  canWriteMenu,
  title = "Deal History",
  subtitle = "Previously used deals for fast reuse. Full menu restore stays in Menu.",
  showTitle = true,
  useAgainLabel = "Use again",
  restoringHistoryId = null,
  onUseAgain,
}: {
  entries: DealHistoryEntry[];
  serverNowIso: string;
  canWriteMenu: boolean;
  title?: string;
  subtitle?: string;
  showTitle?: boolean;
  useAgainLabel?: string;
  restoringHistoryId?: string | null;
  onUseAgain?: (entry: DealHistoryEntry) => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");

  const counts = useMemo(() => statusCounts(entries), [entries]);
  const visibleEntries = useMemo(
    () => entries.filter((entry) => matchesClientFilters(entry, query, status)),
    [entries, query, status],
  );
  const historySections = useMemo(
    () => groupHistoryEntries(visibleEntries, serverNowIso),
    [visibleEntries, serverNowIso],
  );

  return (
    <div>
      <div
        className={`flex flex-col gap-4 lg:flex-row lg:items-end ${
          showTitle ? "lg:justify-between" : "lg:justify-end"
        }`}
      >
        {showTitle && (
          <div className="min-w-0">
            <h1 className="display text-3xl">{title}</h1>
            <div className="mt-2 text-xs font-black tracking-widest text-stone-500">
              {subtitle}
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
          <label className="flex min-w-0 items-center gap-2 rounded-xl border border-stone-300 bg-white px-3 py-2 sm:w-80">
            <Search
              size={15}
              strokeWidth={2.5}
              className="shrink-0 text-stone-400"
              aria-hidden
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search deals, items, combo..."
              className="min-w-0 flex-1 bg-transparent text-sm font-bold outline-none placeholder:text-stone-400"
            />
          </label>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => {
          const active = status === filter.key;
          return (
            <button
              key={filter.key}
              type="button"
              onClick={() => setStatus(filter.key)}
              aria-pressed={active}
              className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-black uppercase tracking-widest ${
                active
                  ? "border-stone-950 bg-stone-950 text-white"
                  : "border-stone-200 bg-white text-stone-700 hover:border-stone-400"
              }`}
            >
              {filter.label}
              <span
                className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] ${
                  active ? "bg-white/15 text-white" : "bg-stone-100 text-stone-500"
                }`}
              >
                {counts[filter.key]}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 text-xs font-black uppercase tracking-widest text-stone-500">
        Previously used deals
      </div>

      {visibleEntries.length === 0 ? (
        <div className="mt-3 rounded-xl border border-dashed border-stone-300 bg-stone-50 p-8 text-center">
          <div className="text-sm font-black text-stone-900">
            No matching deal history
          </div>
          <div className="mt-1 text-xs font-bold text-stone-500">
            Clear the search or choose a different status.
          </div>
        </div>
      ) : (
        <div className="mt-3 space-y-7">
          {historySections.map((section) => (
            <section key={section.key}>
              <div className="mb-3 flex items-center gap-4">
                <h2 className="text-sm font-black uppercase tracking-widest text-stone-500">
                  {section.label}
                </h2>
                <div className="h-px flex-1 bg-stone-200" />
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                {section.entries.map((entry) => (
                  <div
                    key={entry.historyId}
                    className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-stone-200 text-2xl"
                        style={{ background: entry.dealSnapshot.bgColor }}
                        aria-hidden
                      >
                        {entry.dealSnapshot.emoji || "🍔"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="min-w-0 truncate text-lg font-black text-stone-950">
                            {entry.dealSnapshot.name}
                          </div>
                          <span
                            className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${statusTone(
                              entry.status,
                            )}`}
                          >
                            {statusLabel(entry.status)}
                          </span>
                          {entry.dealSnapshot.comboNum != null && (
                            <span className="rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-stone-600">
                              Combo {entry.dealSnapshot.comboNum}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 text-sm font-bold text-stone-600">
                          {fmt(entry.dealSnapshot.price)}
                          {entry.dealSnapshot.bundleSavings != null
                            ? ` · Save ${fmt(entry.dealSnapshot.bundleSavings)}`
                            : ""}
                        </div>
                        <div className="mt-2 text-sm font-semibold leading-snug text-stone-600">
                          Includes: {includedItems(entry)}
                        </div>
                        <div className="mt-2 text-[11px] font-bold uppercase tracking-widest text-stone-400">
                          {formatHistoryTime(entry.lastChangedAt, section.key)}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <div className="text-xs font-bold text-stone-500">
                        {canWriteMenu && onUseAgain
                          ? "Opens as a draft before saving."
                          : "History snapshot only."}
                      </div>
                      {canWriteMenu && onUseAgain && (
                        <button
                          type="button"
                          onClick={() => onUseAgain(entry)}
                          disabled={restoringHistoryId != null}
                          className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[11px] font-black uppercase tracking-widest disabled:opacity-50"
                          style={{ background: BRAND.black, color: BRAND.yellow }}
                        >
                          <RotateCcw
                            size={13}
                            strokeWidth={2.5}
                            className={
                              restoringHistoryId === entry.historyId
                                ? "animate-spin"
                                : ""
                            }
                            aria-hidden
                          />
                          {restoringHistoryId === entry.historyId
                            ? "Opening"
                            : useAgainLabel}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
