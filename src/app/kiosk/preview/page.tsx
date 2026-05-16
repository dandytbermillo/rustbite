"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import CustomizeScreen from "@/components/kiosk/CustomizeScreen";
import MenuScreen from "@/components/kiosk/MenuScreen";
import { BRAND } from "@/lib/brand";
import { GST_RATE, computeLineTotal, round2 } from "@/lib/pricing";
import { snapshotFromUpgradeOption } from "@/lib/upgrade-snapshot";
import type {
  AddOnSetCartSelection,
  CartItemState,
  CategoryDTO,
  MenuItemDTO,
  Modifier,
  UpgradeSnapshot,
} from "@/lib/types";

type MenuResponse = { categories: CategoryDTO[]; items: MenuItemDTO[] };

const optToMod = (opt: { id: string; name: string; priceDelta: number } | undefined): Modifier | null =>
  opt ? { id: opt.id, name: opt.name, price: opt.priceDelta } : null;

async function fetchMenuData(): Promise<MenuResponse> {
  const response = await fetch("/api/menu", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Menu load failed (${response.status})`);
  }
  return (await response.json()) as MenuResponse;
}

function pickActiveCategory(requested: string | null, categories: CategoryDTO[]): string {
  if (requested && categories.some((c) => c.slug === requested)) return requested;
  return categories[0]?.slug ?? "deals";
}

function PreviewToast({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  useEffect(() => {
    const id = window.setTimeout(onDismiss, 2400);
    return () => window.clearTimeout(id);
  }, [onDismiss]);

  return (
    <div
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-full text-xs font-black tracking-widest shadow-lg"
      style={{ background: BRAND.black, color: "white" }}
      role="status"
      aria-live="polite"
    >
      {message}
    </div>
  );
}

function PreviewBadge() {
  return (
    <div
      className="fixed top-3 right-3 z-40 px-3 py-1 rounded-full text-[10px] font-black tracking-widest shadow"
      style={{ background: BRAND.yellow, color: BRAND.black }}
      aria-hidden="true"
    >
      PREVIEW MODE
    </div>
  );
}

function KioskPreviewInner() {
  const searchParams = useSearchParams();
  const requestedCategory = searchParams.get("category");

  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<string>(
    requestedCategory ?? "deals"
  );
  const [screen, setScreen] = useState<"menu" | "customize">("menu");
  const [selectedItem, setSelectedItem] = useState<MenuItemDTO | null>(null);
  const [cSize, setCSize] = useState<Modifier | null>(null);
  const [cAddons, setCAddons] = useState<Modifier[]>([]);
  const [cAddOnSetSelections, setCAddOnSetSelections] = useState<
    AddOnSetCartSelection[]
  >([]);
  const [cSelectedUpgradeId, setCSelectedUpgradeId] = useState<string | null>(null);
  const [cSelectedUpgradeSnapshot, setCSelectedUpgradeSnapshot] =
    useState<UpgradeSnapshot | null>(null);
  const [cQty, setCQty] = useState(1);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const data = await fetchMenuData();
        if (!alive) return;
        setMenu(data);
        setActiveCategory((current) =>
          pickActiveCategory(requestedCategory ?? current, data.categories)
        );
      } catch (err) {
        if (alive) setMenuError((err as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [requestedCategory]);

  // Cart math is computed but always over an empty cart in preview — keeps
  // MenuScreen's required props happy without faking a full cart pipeline.
  const emptyCart: CartItemState[] = useMemo(() => [], []);
  const subtotal = round2(emptyCart.reduce((s, ci) => s + computeLineTotal(ci), 0));
  const gst = round2(subtotal * GST_RATE);
  const total = round2(subtotal + gst);

  const openItem = (item: MenuItemDTO) => {
    if (item.isOutOfStock) return;
    const defaultUpgrade =
      item.upgradeOptions.length === 1 ? item.upgradeOptions[0] : null;
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

  const handlePreviewAdd = () => {
    setToast("Preview mode — nothing was added to a cart.");
    setScreen("menu");
  };

  if (menuError) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center p-8 text-center"
        style={{ background: BRAND.cream, color: BRAND.black }}
      >
        <PreviewBadge />
        <div className="text-7xl mb-4">😶</div>
        <div className="display text-3xl mb-2">Preview can&apos;t load the menu</div>
        <div className="text-sm opacity-70">{menuError}</div>
      </div>
    );
  }

  if (!menu) {
    return (
      <div
        className="min-h-screen flex flex-col items-center justify-center"
        style={{ background: BRAND.cream, color: BRAND.black }}
      >
        <PreviewBadge />
        <div className="text-6xl mb-3 wiggle">🍔</div>
        <div className="display text-2xl tracking-wider">LOADING PREVIEW…</div>
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
      <PreviewBadge />
      {screen === "menu" && (
        <MenuScreen
          mode="preview"
          orderType="DINE_IN"
          categories={menu.categories}
          items={menu.items}
          activeCategory={activeCategory}
          setActiveCategory={setActiveCategory}
          onItem={openItem}
          cart={emptyCart}
          updateQty={() => {}}
          removeLine={() => {}}
          subtotal={subtotal}
          gst={gst}
          total={total}
          itemCount={0}
          onCheckout={() => {}}
          onBack={() => {}}
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
          maxQty={null}
          onAdd={handlePreviewAdd}
          onBack={() => setScreen("menu")}
        />
      )}
      {toast && <PreviewToast message={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

export default function KioskPreviewPage() {
  return (
    <Suspense
      fallback={
        <div
          className="min-h-screen flex items-center justify-center"
          style={{ background: BRAND.cream, color: BRAND.black }}
        >
          <div className="display text-2xl">LOADING PREVIEW…</div>
        </div>
      }
    >
      <KioskPreviewInner />
    </Suspense>
  );
}
