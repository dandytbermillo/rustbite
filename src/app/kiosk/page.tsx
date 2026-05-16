"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ConfirmationScreen from "@/components/kiosk/ConfirmationScreen";
import CartScreen from "@/components/kiosk/CartScreen";
import CustomizeScreen from "@/components/kiosk/CustomizeScreen";
import LargeTextToggle from "@/components/kiosk/LargeTextToggle";
import MenuScreen from "@/components/kiosk/MenuScreen";
import OrderTypeScreen from "@/components/kiosk/OrderTypeScreen";
import PaymentScreen from "@/components/kiosk/PaymentScreen";
import WelcomeScreen from "@/components/kiosk/WelcomeScreen";
import { BRAND } from "@/lib/brand";
import { redirectToDeviceLogin } from "@/lib/device-client-auth";
import {
  MENU_REVIEW_MESSAGE,
  computeCartTotals,
  formatStockUnavailableNotice,
  isStaleMenuErrorCode,
  maxOrderableQuantityForItem,
  rebuildCartAgainstMenu,
  reconcileCustomizeDraftAgainstMenu,
} from "@/lib/kiosk-cart-reconcile";
import {
  isCounterAwaitingPaymentStatus,
  isSuccessfulPaymentStatus,
  isTerminalPendingStatus,
} from "@/lib/payments";
import { GST_RATE, computeLineTotal, round2 } from "@/lib/pricing";
import { snapshotFromUpgradeOption } from "@/lib/upgrade-snapshot";
import type {
  AddOnSetCartSelection,
  CartItemState,
  CheckoutRequestInput,
  CategoryDTO,
  MenuItemDTO,
  Modifier,
  ModifierOption,
  OrderStatus,
  OrderType,
  PaymentMethod,
  PaymentSessionErrorResponse,
  PaymentSessionSummary,
  StockUnavailableResponseItem,
  UpgradeSnapshot,
} from "@/lib/types";

type Screen =
  | "welcome"
  | "orderType"
  | "menu"
  | "customize"
  | "cart"
  | "payment"
  | "confirmation";

type MenuResponse = {
  outletId: string;
  revision: number;
  updatedAt: string;
  scheduleRefreshAt: string | null;
  categories: CategoryDTO[];
  items: MenuItemDTO[];
};
type MenuVersionResponse = Pick<MenuResponse, "outletId" | "revision" | "updatedAt">;
type CustomizeDraftState = {
  selectedItem: MenuItemDTO | null;
  size: Modifier | null;
  addons: Modifier[];
  addOnSetSelections: AddOnSetCartSelection[];
  selectedUpgradeOptionId: string | null;
  selectedUpgradeSnapshot: UpgradeSnapshot | null;
  qty: number;
};
type PaymentSessionRequestResult =
  | { ok: true; session: PaymentSessionSummary }
  | ({ ok: false } & PaymentSessionErrorResponse);
type CartLineIssue = {
  message: string;
  requestedQty: number;
  availableQty: number;
};

const MENU_PICK_AGAIN_MESSAGE = "Menu changed. Please pick this item again.";
const MENU_VERSION_POLL_INTERVAL_MS = 2000;
const MENU_SSE_STALE_MS = 30_000;
const MENU_SCHEDULE_REFRESH_GRACE_MS = 1_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const DEVICE_NEXT_PATH = "/kiosk";
const optToMod = (o: ModifierOption | undefined): Modifier | null =>
  o ? { id: o.id, name: o.name, price: o.priceDelta } : null;

function pickActiveCategory(current: string, categories: CategoryDTO[]): string {
  if (categories.some((category) => category.slug === current)) {
    return current;
  }

  return categories[0]?.slug ?? current;
}

async function fetchMenuData(): Promise<MenuResponse> {
  const response = await fetch("/api/menu", { cache: "no-store" });
  if (response.status === 401) {
    redirectToDeviceLogin(DEVICE_NEXT_PATH);
    throw new Error("Device session expired.");
  }
  if (!response.ok) {
    throw new Error(`Menu load failed (${response.status})`);
  }
  return (await response.json()) as MenuResponse;
}

async function fetchMenuVersion(): Promise<MenuVersionResponse> {
  const response = await fetch("/api/menu/version", { cache: "no-store" });
  if (response.status === 401) {
    redirectToDeviceLogin(DEVICE_NEXT_PATH);
    throw new Error("Device session expired.");
  }
  if (!response.ok) {
    throw new Error(`Menu version check failed (${response.status})`);
  }
  return (await response.json()) as MenuVersionResponse;
}

export default function KioskPage() {
  const [screen, setScreen] = useState<Screen>("welcome");
  const [orderType, setOrderType] = useState<OrderType>("DINE_IN");
  const [activeCategory, setActiveCategory] = useState<string>("deals");
  const [selectedItem, setSelectedItem] = useState<MenuItemDTO | null>(null);
  const [cart, setCart] = useState<CartItemState[]>([]);
  const [orderNumber, setOrderNumber] = useState<string>("");
  const [orderTotal, setOrderTotal] = useState<number>(0);
  const [orderStatus, setOrderStatus] = useState<OrderStatus>("PAID");
  const [orderPaymentMethod, setOrderPaymentMethod] =
    useState<PaymentMethod | null>(null);

  const [cSize, setCSize] = useState<Modifier | null>(null);
  const [cAddons, setCAddons] = useState<Modifier[]>([]);
  const [cAddOnSetSelections, setCAddOnSetSelections] = useState<
    AddOnSetCartSelection[]
  >([]);
  const [cSelectedUpgradeId, setCSelectedUpgradeId] = useState<string | null>(null);
  const [cSelectedUpgradeSnapshot, setCSelectedUpgradeSnapshot] =
    useState<UpgradeSnapshot | null>(null);
  const [cQty, setCQty] = useState(1);

  const handleSelectedUpgradeChange = (
    next: { id: string; snapshot: UpgradeSnapshot } | null
  ) => {
    if (next == null) {
      setCSelectedUpgradeId(null);
      setCSelectedUpgradeSnapshot(null);
    } else {
      setCSelectedUpgradeId(next.id);
      setCSelectedUpgradeSnapshot(next.snapshot);
    }
  };

  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [menuNotice, setMenuNotice] = useState<string | null>(null);
  const [cartNotice, setCartNotice] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [payStatus, setPayStatus] = useState<string | null>(null);
  const latestMenuRevisionRef = useRef(0);
  const menuRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const scheduleRefreshInFlightRef = useRef<Promise<void> | null>(null);
  const menuRefreshTargetRevisionRef = useRef(0);
  const customizeDraftRef = useRef<CustomizeDraftState>({
    selectedItem: null,
    size: null,
    addons: [],
    addOnSetSelections: [],
    selectedUpgradeOptionId: null,
    selectedUpgradeSnapshot: null,
    qty: 1,
  });

  useEffect(() => {
    latestMenuRevisionRef.current = menu?.revision ?? 0;
  }, [menu?.revision]);

  useEffect(() => {
    customizeDraftRef.current = {
      selectedItem,
      size: cSize,
      addons: cAddons,
      addOnSetSelections: cAddOnSetSelections,
      selectedUpgradeOptionId: cSelectedUpgradeId,
      selectedUpgradeSnapshot: cSelectedUpgradeSnapshot,
      qty: cQty,
    };
  }, [
    selectedItem,
    cSize,
    cAddons,
    cAddOnSetSelections,
    cSelectedUpgradeId,
    cSelectedUpgradeSnapshot,
    cQty,
  ]);

  const applyMenu = (nextMenu: MenuResponse) => {
    setMenu(nextMenu);
    setActiveCategory((current) => pickActiveCategory(current, nextMenu.categories));
  };

  const clearCustomizeDraft = () => {
    setSelectedItem(null);
    setCSize(null);
    setCAddons([]);
    setCAddOnSetSelections([]);
    setCSelectedUpgradeId(null);
    setCSelectedUpgradeSnapshot(null);
    setCQty(1);
  };

  const applyMenuRefresh = (nextMenu: MenuResponse) => {
    applyMenu(nextMenu);

    const customizeDraft = customizeDraftRef.current;
    if (customizeDraft.selectedItem) {
      const draftLine: CartItemState = {
        lineId: "customize-draft",
        item: customizeDraft.selectedItem,
        size: customizeDraft.size,
        addons: customizeDraft.addons,
        addOnSetSelections: customizeDraft.addOnSetSelections,
        selectedUpgradeOptionId: customizeDraft.selectedUpgradeOptionId,
        selectedUpgradeSnapshot: customizeDraft.selectedUpgradeSnapshot,
        qty: customizeDraft.qty,
      };
      const rebuiltDraft = reconcileCustomizeDraftAgainstMenu(draftLine, nextMenu);

      if (!rebuiltDraft.ok || rebuiltDraft.totalChanged) {
        clearCustomizeDraft();
        setMenuNotice(MENU_PICK_AGAIN_MESSAGE);
        if (screen === "customize") {
          setScreen("menu");
        }
      } else {
        setSelectedItem(rebuiltDraft.line.item);
        setCSize(rebuiltDraft.line.size);
        setCAddons(rebuiltDraft.line.addons);
        setCAddOnSetSelections(rebuiltDraft.line.addOnSetSelections);
      }
    }

    if (cart.length > 0) {
      const previousTotal = computeCartTotals(cart).total;
      const rebuilt = rebuildCartAgainstMenu(cart, nextMenu);
      if (rebuilt.ok) {
        setCart(rebuilt.cart);
        if (round2(rebuilt.total) !== round2(previousTotal)) {
          setCartNotice(MENU_REVIEW_MESSAGE);
          setMenuNotice(null);
          if (screen !== "cart") {
            clearCustomizeDraft();
            setScreen("cart");
          }
        } else {
          setCartNotice(null);
        }
      } else {
        setCartNotice(rebuilt.message);
        setMenuNotice(null);
        if (screen !== "cart") {
          clearCustomizeDraft();
          setScreen("cart");
        }
      }
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchMenuData();
        if (!alive) return;
        applyMenu(data);
      } catch (err) {
        if (alive) setMenuError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!menu || screen === "payment" || screen === "confirmation") return;

    let alive = true;
    let eventSource: EventSource | null = null;
    let sseOpen = false;
    let lastSseAt = Date.now();

    const refreshMenuForScheduleBoundary = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      if (scheduleRefreshInFlightRef.current) {
        await scheduleRefreshInFlightRef.current;
        return;
      }

      let refreshPromise!: Promise<void>;
      refreshPromise = (async () => {
        try {
          const data = await fetchMenuData();
          if (!alive || data.outletId !== menu.outletId) return;
          applyMenuRefresh(data);
        } catch (err) {
          console.warn("Kiosk scheduled menu refresh failed", err);
        } finally {
          if (scheduleRefreshInFlightRef.current === refreshPromise) {
            scheduleRefreshInFlightRef.current = null;
          }
        }
      })();
      scheduleRefreshInFlightRef.current = refreshPromise;
      await refreshPromise;
    };

    const refreshMenuForRevision = async (targetRevision: number) => {
      if (targetRevision <= latestMenuRevisionRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }

      if (
        menuRefreshInFlightRef.current &&
        menuRefreshTargetRevisionRef.current >= targetRevision
      ) {
        await menuRefreshInFlightRef.current;
        return;
      }

      menuRefreshTargetRevisionRef.current = targetRevision;
      let refreshPromise!: Promise<void>;
      refreshPromise = (async () => {
        try {
          const data = await fetchMenuData();
          if (!alive || data.revision <= latestMenuRevisionRef.current) return;
          applyMenuRefresh(data);
        } catch (err) {
          // A transient menu refresh failure should not interrupt an active kiosk
          // session. Initial load and checkout still surface hard failures.
          console.warn("Kiosk menu refresh failed", err);
        } finally {
          if (menuRefreshInFlightRef.current === refreshPromise) {
            menuRefreshInFlightRef.current = null;
          }
        }
      })();
      menuRefreshInFlightRef.current = refreshPromise;
      await refreshPromise;
    };

    const checkMenuVersion = async () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") {
        return;
      }
      try {
        const version = await fetchMenuVersion();
        if (!alive || version.outletId !== menu.outletId) return;
        await refreshMenuForRevision(version.revision);
      } catch (err) {
        console.warn("Kiosk menu version check failed", err);
      }
    };

    const handleVersionPayload = (rawData: string) => {
      try {
        const version = JSON.parse(rawData) as MenuVersionResponse;
        lastSseAt = Date.now();
        if (version.outletId !== menu.outletId) return;
        void refreshMenuForRevision(version.revision);
      } catch (err) {
        console.warn("Kiosk menu SSE payload was invalid", err);
      }
    };

    if (typeof EventSource !== "undefined") {
      eventSource = new EventSource("/api/menu/events");
      eventSource.onopen = () => {
        sseOpen = true;
        lastSseAt = Date.now();
      };
      eventSource.onerror = () => {
        sseOpen = false;
      };
      eventSource.addEventListener("menu_revision", (event) => {
        handleVersionPayload((event as MessageEvent<string>).data);
      });
      eventSource.addEventListener("heartbeat", () => {
        lastSseAt = Date.now();
      });
      eventSource.addEventListener("auth_expired", () => {
        redirectToDeviceLogin(DEVICE_NEXT_PATH);
      });
      eventSource.addEventListener("reconnect", () => {
        // The server closes long-lived streams periodically; native EventSource
        // reconnect should stay in control so SSE remains the primary path.
        sseOpen = false;
      });
    }

    const interval = window.setInterval(() => {
      if (!sseOpen || Date.now() - lastSseAt > MENU_SSE_STALE_MS) {
        void checkMenuVersion();
      }
    }, MENU_VERSION_POLL_INTERVAL_MS);

    let scheduleTimer: number | null = null;
    const scheduleBoundaryMs = menu.scheduleRefreshAt
      ? new Date(menu.scheduleRefreshAt).getTime()
      : Number.NaN;
    if (Number.isFinite(scheduleBoundaryMs)) {
      const delay = Math.min(
        Math.max(
          0,
          scheduleBoundaryMs - Date.now() + MENU_SCHEDULE_REFRESH_GRACE_MS
        ),
        MAX_TIMEOUT_MS
      );
      scheduleTimer = window.setTimeout(() => {
        void refreshMenuForScheduleBoundary();
      }, delay);
    }

    const refreshStaleScheduleBoundary = () => {
      if (
        Number.isFinite(scheduleBoundaryMs) &&
        scheduleBoundaryMs + MENU_SCHEDULE_REFRESH_GRACE_MS <= Date.now()
      ) {
        void refreshMenuForScheduleBoundary();
      }
    };

    const onFocus = () => {
      void checkMenuVersion();
      refreshStaleScheduleBoundary();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkMenuVersion();
        refreshStaleScheduleBoundary();
      }
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      alive = false;
      eventSource?.close();
      window.clearInterval(interval);
      if (scheduleTimer) window.clearTimeout(scheduleTimer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [cart, menu, screen, selectedItem]);

  const subtotal = useMemo(
    () => round2(cart.reduce((s, ci) => s + computeLineTotal(ci), 0)),
    [cart]
  );
  const gst = round2(subtotal * GST_RATE);
  const total = round2(subtotal + gst);
  const itemCount = cart.reduce((s, ci) => s + ci.qty, 0);
  const menuItemById = useMemo(
    () => new Map((menu?.items ?? []).map((item) => [item.id, item])),
    [menu]
  );
  const cartLineIssues = useMemo(() => {
    const requestedByItem = new Map<string, number>();
    for (const line of cart) {
      requestedByItem.set(
        line.item.id,
        (requestedByItem.get(line.item.id) ?? 0) + line.qty
      );
    }

    const issues: Record<string, CartLineIssue> = {};
    for (const line of cart) {
      const liveItem = menuItemById.get(line.item.id);
      if (!liveItem) {
        issues[line.lineId] = {
          message: `${line.item.name} is no longer available. Remove it before paying.`,
          requestedQty: line.qty,
          availableQty: 0,
        };
        continue;
      }

      if (liveItem.isOutOfStock) {
        issues[line.lineId] = {
          message: `${liveItem.name} is no longer available. Remove it before paying.`,
          requestedQty: line.qty,
          availableQty: 0,
        };
        continue;
      }

      const availableQty = maxOrderableQuantityForItem(liveItem);
      const requestedQty = requestedByItem.get(line.item.id) ?? line.qty;
      if (availableQty != null && requestedQty > availableQty) {
        issues[line.lineId] = {
          message:
            availableQty <= 0
              ? `${liveItem.name} is no longer available. Remove it before paying.`
              : `Only ${availableQty} left for ${liveItem.name}. You have ${requestedQty} in your order.`,
          requestedQty,
          availableQty,
        };
      }
    }

    return issues;
  }, [cart, menuItemById]);
  const hasCartLineIssues = Object.keys(cartLineIssues).length > 0;

  const quantityInCartForItem = (
    menuItemId: string,
    cartItems: CartItemState[] = cart,
    excludingLineId?: string
  ) =>
    cartItems.reduce(
      (sum, line) =>
        line.item.id === menuItemId && line.lineId !== excludingLineId
          ? sum + line.qty
          : sum,
      0
    );

  const remainingQuantityForItem = (
    item: MenuItemDTO,
    cartItems: CartItemState[] = cart,
    excludingLineId?: string
  ) => {
    const maxOrderableQty = maxOrderableQuantityForItem(item);
    if (maxOrderableQty == null) return null;
    return Math.max(
      0,
      maxOrderableQty - quantityInCartForItem(item.id, cartItems, excludingLineId)
    );
  };

  const stockLimitNoticeForItem = (
    item: MenuItemDTO,
    requestedQty: number,
    availableQty: number
  ) =>
    formatStockUnavailableNotice([
      {
        menuItemId: item.id,
        nameSnapshot: item.name,
        requestedQty,
        availableQty,
      },
    ]);

  const openItem = (item: MenuItemDTO) => {
    if (item.isOutOfStock) return;
    const remainingQty = remainingQuantityForItem(item);
    if (remainingQty === 0) {
      setMenuNotice(
        stockLimitNoticeForItem(
          item,
          quantityInCartForItem(item.id) + 1,
          maxOrderableQuantityForItem(item) ?? 0
        )
      );
      return;
    }
    const defaultUpgrade = item.upgradeOptions.length === 1 ? item.upgradeOptions[0] : null;

    setMenuNotice(null);
    setCartNotice(null);
    setSelectedItem(item);
    setCSize(optToMod(item.sizes[1] ?? item.sizes[0]));
    setCAddons([]);
    setCAddOnSetSelections([]);
    setCSelectedUpgradeId(defaultUpgrade?.id ?? null);
    setCSelectedUpgradeSnapshot(
      defaultUpgrade ? snapshotFromUpgradeOption(defaultUpgrade) : null
    );
    setCQty(1);
    setScreen("customize");
  };

  const addToCart = () => {
    if (!selectedItem || selectedItem.isOutOfStock) return;
    const remainingQty = remainingQuantityForItem(selectedItem);
    if (remainingQty != null && cQty > remainingQty) {
      setCQty(Math.max(1, remainingQty));
      setCartNotice(
        stockLimitNoticeForItem(
          selectedItem,
          quantityInCartForItem(selectedItem.id) + cQty,
          maxOrderableQuantityForItem(selectedItem) ?? 0
        )
      );
      setScreen("cart");
      return;
    }
    setMenuNotice(null);
    setCartNotice(null);
    setCart((prev) => [
      ...prev,
      {
        lineId: `${selectedItem.id}-${Date.now()}`,
        item: selectedItem,
        size: cSize,
        addons: cAddons,
        addOnSetSelections: cAddOnSetSelections,
        selectedUpgradeOptionId: cSelectedUpgradeId,
        selectedUpgradeSnapshot: cSelectedUpgradeSnapshot,
        qty: cQty,
      },
    ]);
    setScreen("menu");
  };

  const quickAdd = (item: MenuItemDTO) => {
    if (item.isOutOfStock) return;
    const remainingQty = remainingQuantityForItem(item);
    if (remainingQty === 0) {
      setCartNotice(
        stockLimitNoticeForItem(
          item,
          quantityInCartForItem(item.id) + 1,
          maxOrderableQuantityForItem(item) ?? 0
        )
      );
      return;
    }
    setMenuNotice(null);
    const defaultSize = optToMod(item.sizes[1] ?? item.sizes[0]);
    setCartNotice(null);
    setCart((prev) => [
      ...prev,
      {
        lineId: `${item.id}-${Date.now()}`,
        item,
        size: defaultSize,
        addons: [],
        addOnSetSelections: [],
        selectedUpgradeOptionId: null,
        selectedUpgradeSnapshot: null,
        qty: 1,
      },
    ]);
  };

  const updateQty = (lineId: string, delta: number) => {
    setMenuNotice(null);
    setCartNotice(null);
    const targetLine = cart.find((line) => line.lineId === lineId);
    if (targetLine && delta > 0) {
      const liveItem = menuItemById.get(targetLine.item.id) ?? targetLine.item;
      const nextQty = targetLine.qty + delta;
      const remainingQty = remainingQuantityForItem(liveItem, cart, lineId);
      if (remainingQty != null && nextQty > remainingQty) {
        setCartNotice(
          stockLimitNoticeForItem(
            liveItem,
            quantityInCartForItem(liveItem.id, cart, lineId) + nextQty,
            maxOrderableQuantityForItem(liveItem) ?? 0
          )
        );
        return;
      }
    }
    setCart((prev) =>
      prev
        .map((ci) =>
          ci.lineId === lineId ? { ...ci, qty: Math.max(0, ci.qty + delta) } : ci
        )
        .filter((ci) => ci.qty > 0)
    );
  };

  const resolveLineQuantityIssue = (lineId: string) => {
    const targetLine = cart.find((line) => line.lineId === lineId);
    if (!targetLine) return;

    const liveItem = menuItemById.get(targetLine.item.id);
    if (!liveItem || liveItem.isOutOfStock) {
      setMenuNotice(null);
      setCartNotice(null);
      setCart((prev) => prev.filter((line) => line.lineId !== lineId));
      return;
    }

    const maxOrderableQty = maxOrderableQuantityForItem(liveItem);
    if (maxOrderableQty == null) return;

    const otherQty = quantityInCartForItem(liveItem.id, cart, lineId);
    const nextQty = Math.max(0, maxOrderableQty - otherQty);

    setMenuNotice(null);
    setCartNotice(null);
    setCart((prev) =>
      prev
        .map((line) =>
          line.lineId === lineId ? { ...line, qty: nextQty } : line
        )
        .filter((line) => line.qty > 0)
    );
  };

  const removeLine = (lineId: string) => {
    setMenuNotice(null);
    setCartNotice(null);
    setCart((prev) => prev.filter((ci) => ci.lineId !== lineId));
  };

  const buildCheckoutBody = (
    paymentMethod: PaymentMethod,
    cartItems: CartItemState[],
    expectedTotal: number
  ): CheckoutRequestInput => ({
    orderType,
    paymentMethod,
    expectedTotal,
    items: cartItems.map((ci) => ({
      menuItemId: ci.item.id,
      qty: ci.qty,
      sizeId: ci.size?.id ?? null,
      addonIds: ci.addons.map((addon) => addon.id),
      addOnSetSelections: ci.addOnSetSelections.map((selection) => ({
        itemLinkId: selection.itemLinkId,
        optionIds: selection.options.map((option) => option.id),
      })),
      selectedUpgradeOptionId: ci.selectedUpgradeOptionId,
    })),
  });

  const paymentStatusText = (session: PaymentSessionSummary): string => {
    switch (session.status) {
      case "CREATED":
        return "Preparing payment session…";
      case "PROCESSING":
        return "Waiting for payment on the reader…";
      case "AUTHORIZED":
        return "Payment authorized. Finalizing order…";
      case "CAPTURED":
        return "Payment captured. Finalizing order…";
      case "PENDING_COUNTER_PAYMENT":
        return "Order created. Collect payment at the counter to start prep.";
      case "FAILED":
        return session.failureMessage || "Payment failed.";
      case "CANCELLED":
        return session.failureMessage || "Payment was cancelled.";
      default:
        return "Processing payment…";
    }
  };

  const pollPaymentSession = async (
    sessionId: string
  ): Promise<PaymentSessionSummary> => {
    for (let attempt = 0; attempt < 45; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const response = await fetch(`/api/payments/sessions/${sessionId}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        redirectToDeviceLogin(DEVICE_NEXT_PATH);
        throw new Error("Device session expired.");
      }
      const session = (await response.json()) as PaymentSessionSummary & {
        error?: string;
      };

      if (!response.ok) {
        throw new Error(session.error || `Payment status failed (${response.status})`);
      }

      setPayStatus(paymentStatusText(session));
      if (
        isSuccessfulPaymentStatus(session.status) ||
        isCounterAwaitingPaymentStatus(session.status) ||
        session.status === "FAILED" ||
        session.status === "CANCELLED"
      ) {
        return session;
      }
    }

    throw new Error("Payment timed out while waiting for the reader.");
  };

  const requestPaymentSession = async (
    paymentMethod: PaymentMethod,
    cartItems: CartItemState[],
    expectedTotal: number
  ): Promise<PaymentSessionRequestResult> => {
    const sessionResponse = await fetch("/api/payments/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildCheckoutBody(paymentMethod, cartItems, expectedTotal)),
    });
    if (sessionResponse.status === 401) {
      redirectToDeviceLogin(DEVICE_NEXT_PATH);
      throw new Error("Device session expired.");
    }

    const sessionJson = (await sessionResponse.json().catch(() => ({}))) as
      | PaymentSessionSummary
      | PaymentSessionErrorResponse;

    if (!sessionResponse.ok) {
      const errorPayload = sessionJson as Partial<PaymentSessionErrorResponse>;
      return {
        ok: false,
        error:
          errorPayload.error ||
          errorPayload.failureMessage ||
          `Payment failed (${sessionResponse.status})`,
        errorCode: errorPayload.errorCode,
        failureMessage: errorPayload.failureMessage ?? undefined,
        items: errorPayload.items,
      };
    }

    return { ok: true, session: sessionJson as PaymentSessionSummary };
  };

  const sendToCartForReview = (message: string, nextCart?: CartItemState[]) => {
    if (nextCart) {
      setCart(nextCart);
    }
    setPayStatus(null);
    setPayError(null);
    setCartNotice(message);
    setScreen("cart");
  };

  const placeOrder = async (paymentMethod: PaymentMethod) => {
    setPayError(null);
    setCartNotice(null);
    setMenuNotice(null);
    setPayStatus("Preparing payment session…");

    try {
      const displayedTotal = total;
      let checkoutCart = cart;
      let sessionResult = await requestPaymentSession(
        paymentMethod,
        checkoutCart,
        displayedTotal
      );

      if (!sessionResult.ok && sessionResult.errorCode === "MENU_STOCK_UNAVAILABLE") {
        setPayStatus("Refreshing menu…");
        const freshMenu = await fetchMenuData();
        applyMenu(freshMenu);
        const rebuilt = rebuildCartAgainstMenu(checkoutCart, freshMenu);
        sendToCartForReview(
          sessionResult.items
            ? formatStockUnavailableNotice(sessionResult.items)
            : rebuilt.ok
              ? MENU_REVIEW_MESSAGE
              : rebuilt.message,
          rebuilt.ok ? rebuilt.cart : undefined
        );
        return;
      }

      if (!sessionResult.ok && isStaleMenuErrorCode(sessionResult.errorCode)) {
        setPayStatus("Refreshing menu…");
        const freshMenu = await fetchMenuData();
        applyMenu(freshMenu);

        const rebuilt = rebuildCartAgainstMenu(checkoutCart, freshMenu);
        if (!rebuilt.ok) {
          sendToCartForReview(rebuilt.message);
          return;
        }

        if (round2(rebuilt.total) !== round2(displayedTotal)) {
          sendToCartForReview(MENU_REVIEW_MESSAGE, rebuilt.cart);
          return;
        }

        checkoutCart = rebuilt.cart;
        setCart(rebuilt.cart);
        setPayStatus("Retrying with updated menu…");
        sessionResult = await requestPaymentSession(
          paymentMethod,
          checkoutCart,
          displayedTotal
        );

        if (!sessionResult.ok && sessionResult.errorCode === "MENU_STOCK_UNAVAILABLE") {
          setPayStatus("Refreshing menu…");
          const latestMenu = await fetchMenuData();
          applyMenu(latestMenu);
          const latestRebuild = rebuildCartAgainstMenu(checkoutCart, latestMenu);
          sendToCartForReview(
            sessionResult.items
              ? formatStockUnavailableNotice(sessionResult.items)
              : latestRebuild.ok
                ? MENU_REVIEW_MESSAGE
                : latestRebuild.message,
            latestRebuild.ok ? latestRebuild.cart : undefined
          );
          return;
        }

        if (!sessionResult.ok && isStaleMenuErrorCode(sessionResult.errorCode)) {
          setPayStatus("Refreshing menu…");
          const latestMenu = await fetchMenuData();
          applyMenu(latestMenu);
          const latestRebuild = rebuildCartAgainstMenu(checkoutCart, latestMenu);
          sendToCartForReview(
            latestRebuild.ok ? MENU_REVIEW_MESSAGE : latestRebuild.message,
            latestRebuild.ok ? latestRebuild.cart : undefined
          );
          return;
        }
      }

      if (!sessionResult.ok) {
        throw new Error(sessionResult.error);
      }

      let session = sessionResult.session;
      setPayStatus(paymentStatusText(session));

      if (isTerminalPendingStatus(session.status)) {
        session = await pollPaymentSession(session.id);
      }

      if (
        !isSuccessfulPaymentStatus(session.status) &&
        !isCounterAwaitingPaymentStatus(session.status)
      ) {
        throw new Error(session.failureMessage || "Payment was not approved.");
      }

      setPayStatus("Finalizing order…");
      const orderResponse = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentSessionId: session.id }),
      });
      if (orderResponse.status === 401) {
        redirectToDeviceLogin(DEVICE_NEXT_PATH);
        throw new Error("Device session expired.");
      }

      if (!orderResponse.ok) {
        const errorJson = (await orderResponse.json().catch(() => ({}))) as {
          error?: string;
          errorCode?: PaymentSessionErrorResponse["errorCode"];
          items?: StockUnavailableResponseItem[];
        };
        if (errorJson.errorCode === "MENU_STOCK_UNAVAILABLE") {
          setPayStatus("Refreshing menu…");
          const freshMenu = await fetchMenuData();
          applyMenu(freshMenu);
          const rebuilt = rebuildCartAgainstMenu(checkoutCart, freshMenu);
          sendToCartForReview(
            errorJson.items
              ? formatStockUnavailableNotice(errorJson.items)
              : rebuilt.ok
                ? MENU_REVIEW_MESSAGE
                : rebuilt.message,
            rebuilt.ok ? rebuilt.cart : undefined
          );
          return;
        }
        if (isStaleMenuErrorCode(errorJson.errorCode)) {
          setPayStatus("Refreshing menu…");
          const freshMenu = await fetchMenuData();
          applyMenu(freshMenu);
          const rebuilt = rebuildCartAgainstMenu(checkoutCart, freshMenu);
          sendToCartForReview(
            rebuilt.ok ? MENU_REVIEW_MESSAGE : rebuilt.message,
            rebuilt.ok ? rebuilt.cart : undefined
          );
          return;
        }
        throw new Error(errorJson.error || `Order failed (${orderResponse.status})`);
      }

      const data = (await orderResponse.json()) as {
        orderNumber: string;
        status: OrderStatus;
        total: number;
        paymentMethod: PaymentMethod | null;
      };
      setOrderNumber(data.orderNumber);
      setOrderTotal(data.total);
      setOrderStatus(data.status);
      setOrderPaymentMethod(data.paymentMethod);
      setPayStatus(null);
      setScreen("confirmation");
    } catch (err) {
      setPayStatus(null);
      setPayError((err as Error).message);
    }
  };

  const startOver = () => {
    setScreen("welcome");
    setCart([]);
    setSelectedItem(null);
    setOrderNumber("");
    setOrderTotal(0);
    setOrderStatus("PAID");
    setOrderPaymentMethod(null);
    setCartNotice(null);
    setMenuNotice(null);
    setPayError(null);
    setPayStatus(null);
  };

  // Loading / error states
  if (menuError) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-8 text-center"
        style={{ background: BRAND.cream, color: BRAND.black }}
      >
        <div className="text-7xl mb-4">😶</div>
        <div className="display text-4xl mb-3">Can&apos;t load the menu</div>
        <div className="text-sm opacity-70 mb-6">{menuError}</div>
        <button
          onClick={() => location.reload()}
          className="btn-press px-8 py-4 rounded-full display text-lg"
          style={{ background: BRAND.red, color: "white" }}
        >
          RETRY
        </button>
      </div>
    );
  }

  if (!menu) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center"
        style={{ background: BRAND.cream, color: BRAND.black }}
      >
        <div className="text-7xl mb-4 wiggle">🍔</div>
        <div className="display text-3xl tracking-wider">WARMING UP THE GRILL…</div>
        <div className="mt-6 w-10 h-10 border-4 border-current border-t-transparent rounded-full animate-spin opacity-60" />
      </div>
    );
  }

  return (
    <div
      className="min-h-screen w-full"
      style={{
        background: BRAND.cream,
        color: BRAND.black,
        fontFamily: "'Archivo', 'Inter', system-ui, sans-serif",
      }}
    >
      {screen === "welcome" && <WelcomeScreen onStart={() => setScreen("orderType")} />}

      {screen === "orderType" && (
        <OrderTypeScreen
          onPick={(t) => {
            setOrderType(t);
            setScreen("menu");
          }}
          onBack={() => setScreen("welcome")}
        />
      )}

      {screen === "menu" && (
        <MenuScreen
          orderType={orderType}
          categories={menu.categories}
          items={menu.items}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          onItem={openItem}
          cart={cart}
          updateQty={updateQty}
          removeLine={removeLine}
          subtotal={subtotal}
          gst={gst}
          total={total}
          itemCount={itemCount}
          notice={menuNotice}
          onCheckout={() => cart.length > 0 && setScreen("cart")}
          onBack={() => setScreen("orderType")}
        />
      )}

      {screen === "customize" && selectedItem && (
        <CustomizeScreen
          item={selectedItem}
          size={cSize}
          setSize={setCSize}
          addons={cAddons}
          addOnSetSelections={cAddOnSetSelections}
          setAddOnSetSelections={setCAddOnSetSelections}
          selectedUpgradeOptionId={cSelectedUpgradeId}
          selectedUpgradeSnapshot={cSelectedUpgradeSnapshot}
          setSelectedUpgrade={handleSelectedUpgradeChange}
          qty={cQty}
          setQty={setCQty}
          maxQty={remainingQuantityForItem(selectedItem)}
          onAdd={addToCart}
          onBack={() => setScreen("menu")}
        />
      )}

      {screen === "cart" && (
        <CartScreen
          cart={cart}
          items={menu.items}
          notice={cartNotice}
          lineIssues={cartLineIssues}
          updateQty={updateQty}
          removeLine={removeLine}
          resolveLineIssue={resolveLineQuantityIssue}
          subtotal={subtotal}
          gst={gst}
          total={total}
          orderType={orderType}
          onAddUpsell={quickAdd}
          onBack={() => setScreen("menu")}
          onPay={() => {
            if (hasCartLineIssues) {
              setCartNotice(
                "Fix the highlighted item before paying."
              );
              return;
            }
            setScreen("payment");
          }}
          payDisabled={hasCartLineIssues}
        />
      )}

      {screen === "payment" && (
        <PaymentScreen
          total={total}
          error={payError}
          statusText={payStatus}
          onPay={placeOrder}
          onBack={() => {
            setPayStatus(null);
            setScreen("cart");
          }}
        />
      )}

      {screen === "confirmation" && (
        <ConfirmationScreen
          orderNumber={orderNumber}
          total={orderTotal || total}
          orderType={orderType}
          orderStatus={orderStatus}
          paymentMethod={orderPaymentMethod}
          onDone={startOver}
        />
      )}

      <LargeTextToggle />
    </div>
  );
}
