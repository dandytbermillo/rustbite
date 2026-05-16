"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { BRAND } from "@/lib/brand";

export type NavCategory = {
  id: string;
  slug: string;
  name: string;
  icon: string;
  itemCount: number;
};

const SUPERSCRIPTS = ["¹", "²", "³", "⁴", "⁵", "⁶", "⁷", "⁸", "⁹"];

export default function CategoryNavBar({
  categories,
  disableShortcuts,
}: {
  categories: NavCategory[];
  disableShortcuts: boolean;
}) {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const suppressObserverRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const pillRefsRef = useRef<Map<string, HTMLAnchorElement>>(new Map());

  useEffect(() => {
    if (typeof window === "undefined") return;
    reducedMotionRef.current = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;
  }, []);

  // Scroll to a section by slug, set the active pill optimistically,
  // suppress observer-driven updates until the scroll settles, then
  // focus the section heading. Used by click, keyboard shortcut, and
  // initial-load hash paths so they all behave the same.
  const scrollToSlug = useCallback((slug: string) => {
    const target = document.getElementById(`cat-${slug}`);
    if (!target) return;
    const heading = target.querySelector<HTMLElement>("[data-cat-heading]");

    suppressObserverRef.current = true;
    setActiveSlug(slug);

    target.scrollIntoView({
      behavior: reducedMotionRef.current ? "auto" : "smooth",
      block: "start",
    });
    history.replaceState(null, "", `#cat-${slug}`);

    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      suppressObserverRef.current = false;
      heading?.focus({ preventScroll: true });
    };

    // Attach both: scrollend fires first on modern browsers; the timeout
    // is the safety net for Safari < 17.5 and edge cases where scrollend
    // never lands. Whichever fires first wins; the rest become no-ops.
    window.addEventListener("scrollend", settle, { once: true });
    window.setTimeout(settle, 600);
  }, []);

  // Scroll the document back to the very top. Clears the hash so the
  // URL doesn't linger from a previous category jump. No focus stealing
  // — operator may want any of the page-header actions next.
  const scrollToTop = useCallback(() => {
    window.scrollTo({
      top: 0,
      behavior: reducedMotionRef.current ? "auto" : "smooth",
    });
    if (window.location.hash) {
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search
      );
    }
    setActiveSlug(null);
  }, []);

  // Keep the active pill horizontally visible inside the overflow
  // container. Without this, prev/next can move the active state to a
  // pill scrolled off the edge of the bar.
  useEffect(() => {
    if (!activeSlug) return;
    const container = scrollContainerRef.current;
    const pill = pillRefsRef.current.get(activeSlug);
    if (!container || !pill) return;
    const containerRect = container.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    if (
      pillRect.left >= containerRect.left &&
      pillRect.right <= containerRect.right
    ) {
      return;
    }
    const pillCenter =
      pillRect.left - containerRect.left + container.scrollLeft + pillRect.width / 2;
    const target = pillCenter - container.clientWidth / 2;
    container.scrollTo({
      left: Math.max(0, target),
      behavior: reducedMotionRef.current ? "auto" : "smooth",
    });
  }, [activeSlug]);

  // Initial-load handling. We distinguish three arrival types:
  //   1. Page reload (F5 / Cmd+R) — always land at top of page, clear any
  //      sticky #cat-{slug} hash from a previous click. This is the
  //      operator-friendly default: reloading shouldn't teleport you to
  //      wherever you last clicked.
  //   2. Fresh navigation with a hash (e.g., shared deep-link) — honor it
  //      and scroll to the matching section.
  //   3. Fresh navigation without a hash (clicked /admin/menu in sidebar)
  //      — natural top-of-page (no scroll needed).
  //
  // We also disable the browser's default "auto" scrollRestoration so
  // last-scroll-position doesn't fight with our explicit reload behavior.
  useEffect(() => {
    const prevScrollRestoration =
      "scrollRestoration" in history ? history.scrollRestoration : "auto";
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }

    const navEntries =
      typeof performance !== "undefined" &&
      typeof performance.getEntriesByType === "function"
        ? (performance.getEntriesByType(
            "navigation"
          ) as PerformanceNavigationTiming[])
        : [];
    const isReload = navEntries[0]?.type === "reload";

    if (isReload) {
      window.scrollTo(0, 0);
      if (window.location.hash) {
        history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search
        );
      }
      return () => {
        if ("scrollRestoration" in history) {
          history.scrollRestoration = prevScrollRestoration;
        }
      };
    }

    // Fresh navigation: honor a deep-link hash if present.
    const hash = window.location.hash;
    if (hash.startsWith("#cat-")) {
      const slug = hash.slice("#cat-".length);
      if (categories.some((c) => c.slug === slug)) {
        const id = requestAnimationFrame(() => scrollToSlug(slug));
        return () => {
          cancelAnimationFrame(id);
          if ("scrollRestoration" in history) {
            history.scrollRestoration = prevScrollRestoration;
          }
        };
      }
    }

    return () => {
      if ("scrollRestoration" in history) {
        history.scrollRestoration = prevScrollRestoration;
      }
    };
    // Mount-only — initial-load behavior should not re-fire when
    // categories change after a search filter. The hash sticks until
    // the user clicks a different pill.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // IntersectionObserver scrollspy. rootMargin pushes the active-zone
  // below the sticky nav so a section is only "active" once its
  // heading is actually visible.
  useEffect(() => {
    if (categories.length === 0) return;
    const navHeight =
      parseInt(
        getComputedStyle(document.documentElement).getPropertyValue("--nav-h"),
        10
      ) || 56;

    const observer = new IntersectionObserver(
      (entries) => {
        if (suppressObserverRef.current) return;
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .map((entry) => ({
            slug: entry.target.id.replace(/^cat-/, ""),
            top: entry.boundingClientRect.top,
          }))
          .sort((a, b) => a.top - b.top);
        if (visible.length === 0) return;
        setActiveSlug(visible[0].slug);
      },
      { rootMargin: `-${navHeight + 8}px 0px 0px 0px` }
    );

    for (const cat of categories) {
      const node = document.getElementById(`cat-${cat.slug}`);
      if (node) observer.observe(node);
    }

    return () => observer.disconnect();
  }, [categories]);

  // Keys 1-9 jump to the Nth visible category. Guards against text
  // input, modals, and modifier keys (Cmd+1..9 is browser tab switch).
  useEffect(() => {
    if (disableShortcuts) return;
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target) {
        if (target.isContentEditable) return;
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      }
      const digit = parseInt(event.key, 10);
      if (!Number.isInteger(digit) || digit < 1 || digit > 9) return;
      const index = digit - 1;
      if (index >= categories.length) return;
      event.preventDefault();
      scrollToSlug(categories[index].slug);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [disableShortcuts, categories, scrollToSlug]);

  if (categories.length === 0) return null;

  const handleClick = (
    event: React.MouseEvent<HTMLAnchorElement>,
    slug: string
  ) => {
    event.preventDefault();
    scrollToSlug(slug);
  };

  // Active position drives prev/next enabled state. activeSlug=null
  // (page is above the first section) → only Next is enabled, jumps
  // to the first category. At a boundary the corresponding button is
  // disabled rather than wrapping — wrap-around is surprising.
  const activeIndex = activeSlug
    ? categories.findIndex((c) => c.slug === activeSlug)
    : -1;
  const canGoPrev = activeIndex > 0;
  const canGoNext =
    activeIndex < 0 ? categories.length > 0 : activeIndex < categories.length - 1;

  const goPrev = () => {
    if (!canGoPrev) return;
    scrollToSlug(categories[activeIndex - 1].slug);
  };
  const goNext = () => {
    if (!canGoNext) return;
    const nextIndex = activeIndex < 0 ? 0 : activeIndex + 1;
    scrollToSlug(categories[nextIndex].slug);
  };

  return (
    <nav
      aria-label="Menu categories"
      className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8 px-4 sm:px-6 lg:px-8 bg-stone-50/95 backdrop-blur border-b border-stone-200"
      style={{ height: "var(--nav-h)" }}
    >
      <div className="flex items-center h-full gap-2">
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            type="button"
            onClick={scrollToTop}
            title="Jump to top of page"
            aria-label="Jump to top of page"
            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white border border-stone-200 text-stone-700 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
          >
            <ArrowUp size={16} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={goPrev}
            disabled={!canGoPrev}
            title="Previous category"
            aria-label="Previous category"
            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white border border-stone-200 text-stone-700 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
          >
            <ChevronLeft size={16} strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={!canGoNext}
            title="Next category"
            aria-label="Next category"
            className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-white border border-stone-200 text-stone-700 hover:bg-stone-100 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
          >
            <ChevronRight size={16} strokeWidth={2.5} />
          </button>
        </div>

        <div
          className="h-px self-stretch my-2 w-px bg-stone-300 flex-shrink-0"
          aria-hidden="true"
        />

        <div
          ref={scrollContainerRef}
          className="h-full overflow-x-auto no-scrollbar flex-1"
        >
          <ul className="flex items-center gap-1.5 h-full min-w-max">
            {categories.map((cat, i) => {
              const isActive = cat.slug === activeSlug;
              return (
                <li key={cat.id}>
                  <a
                    ref={(node) => {
                      if (node) pillRefsRef.current.set(cat.slug, node);
                      else pillRefsRef.current.delete(cat.slug);
                    }}
                    href={`#cat-${cat.slug}`}
                    onClick={(event) => handleClick(event, cat.slug)}
                    aria-current={isActive ? "location" : undefined}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-900"
                    style={
                      isActive
                        ? {
                            background: "white",
                            color: BRAND.black,
                            border: `1.5px solid ${BRAND.yellow}`,
                            boxShadow: `0 0 0 1px ${BRAND.yellow}`,
                          }
                        : {
                            background: "white",
                            color: BRAND.black,
                            border: "1px solid #e7e5e4",
                          }
                    }
                  >
                    <span aria-hidden="true">{cat.icon}</span>
                    <span>{cat.name}</span>
                    <span className="opacity-60">{cat.itemCount}</span>
                    {i < 9 && (
                      <sup
                        className="opacity-50 text-[9px] ml-0.5"
                        aria-hidden="true"
                      >
                        {SUPERSCRIPTS[i]}
                      </sup>
                    )}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </nav>
  );
}
