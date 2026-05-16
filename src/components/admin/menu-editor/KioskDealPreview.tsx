"use client";

import { BRAND } from "@/lib/brand";

type IncludedItem = {
  emoji: string;
  name: string;
  size: string | null;
};

type Props = {
  // Computed by the parent from the upgrade option's renderable links.
  upgradeHeadline: string;          // e.g. "ADD MUSHROOM SWISS"
  upgradeCustomerPays: number;      // = items_total * (1 - pct/100)
  upgradeSave: number;
  includedItems: IncludedItem[];
};

// Mirrors the kiosk's "Make it a meal?" upgrade card. Read-only.
// Note: the previous horizontal item strip (deal emoji + name + price) was
// removed because it didn't match the kiosk layout (the kiosk uses a hero
// layout with a separate combo badge — see CustomizeScreen.tsx). Deal
// identity (name/emoji/price/combo) is already shown in the modal header
// pills, so the preview now focuses on what's unique: the upgrade card.
export default function KioskDealPreview({
  upgradeHeadline,
  upgradeCustomerPays,
  upgradeSave,
  includedItems,
}: Props) {
  const fmt = (n: number) => `$${n.toFixed(2)}`;

  return (
    <div className="rounded-3xl overflow-hidden shadow-2xl" style={{ background: BRAND.black }}>
      {/* Step bar */}
      <div className="flex items-center gap-2 p-3" aria-hidden>
        <Step>✓ Order type</Step>
        <Sep />
        <Step active>2 Menu</Step>
        <Sep />
        <Step>3 Review</Step>
        <Sep />
        <Step>4 Payment</Step>
      </div>

      {/* Screen body. The horizontal "item strip" (deal emoji + name + price)
          was removed because it doesn't match the actual kiosk layout — the
          kiosk renders the deal as a centered hero (large emoji, big name,
          price below) with a separate #N combo badge top-left and a DEAL pill
          top-right (see CustomizeScreen.tsx). The upgrade-card preview below
          IS accurate; that's the part operators are configuring. */}
      <div className="bg-white rounded-xl overflow-hidden mx-3">
        {/* "Make it a meal" CTA */}
        <div className="bg-stone-100 p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <span className="text-[11px] font-black tracking-widest uppercase">Make it a meal?</span>
            <span
              className="px-2 py-0.5 rounded-full text-[9px] font-black tracking-widest uppercase"
              style={{ background: BRAND.red, color: "white" }}
            >
              Save
            </span>
          </div>

          {/* Yellow upgrade card */}
          <div
            className="rounded-2xl p-4 pb-1.5 shadow-md"
            style={{ background: BRAND.yellow }}
          >
            <div className="flex justify-between items-start gap-3 mb-1">
              <div
                className="leading-tight uppercase"
                style={{ fontFamily: "Archivo Black", fontSize: "20px" }}
              >
                {upgradeHeadline}
              </div>
              <div className="text-right flex-shrink-0">
                <div
                  style={{ fontFamily: "Archivo Black", color: BRAND.red, fontSize: "22px", lineHeight: 1 }}
                >
                  +{fmt(upgradeCustomerPays)}
                </div>
                <div className="font-mono text-[11px] font-bold mt-1" style={{ color: BRAND.red }}>
                  Save {fmt(upgradeSave)}
                </div>
              </div>
            </div>
            <div className="text-[10px] font-black tracking-widest uppercase text-stone-700 mt-3">
              Includes
            </div>
            <div className="mt-2 -mx-0.5">
              {includedItems.length === 0 ? (
                <div className="px-1 py-2 text-center text-stone-500 text-xs">
                  Add at least one in-stock linked item.
                </div>
              ) : (
                includedItems.map((it, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 px-1.5 py-2.5 border-b last:border-b-0"
                    style={{ borderColor: "rgba(20,20,20,0.10)" }}
                  >
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center text-xl flex-shrink-0"
                      style={{ background: BRAND.cream }}
                    >
                      {it.emoji}
                    </div>
                    <div className="text-sm font-bold">
                      {it.name}
                      {it.size && <span className="text-stone-700 font-medium"> · {it.size}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* "How many?" stepper. Read-only — mirrors the kiosk's qty
              widget for layout fidelity. The "1" is hardcoded; admin
              never changes qty from this preview. */}
          <div className="mt-3.5 flex items-center gap-2 mb-2.5">
            <span
              className="inline-block w-1 h-3.5 rounded"
              style={{ background: BRAND.red }}
              aria-hidden
            />
            <span className="text-[11px] font-black tracking-widest uppercase">
              How many?
            </span>
          </div>
          <div className="bg-white rounded-2xl shadow-md p-1.5 flex items-center gap-2">
            <div
              className="w-9 h-9 rounded-xl bg-stone-100 flex items-center justify-center text-stone-700 text-base font-bold"
              aria-hidden
            >
              −
            </div>
            <div
              className="flex-1 text-center"
              style={{
                fontFamily: "Archivo Black",
                fontSize: "22px",
                lineHeight: 1,
              }}
            >
              1
            </div>
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center text-base font-bold"
              style={{ background: BRAND.yellow, color: BRAND.black }}
              aria-hidden
            >
              +
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Step({ active, children }: { active?: boolean; children: React.ReactNode }) {
  return (
    <span
      className="px-2.5 py-1.5 rounded-full text-[9px] font-black tracking-widest uppercase whitespace-nowrap"
      style={
        active
          ? { background: BRAND.yellow, color: BRAND.black }
          : { background: "rgba(255,255,255,0.06)", color: "#a8a29e" }
      }
    >
      {children}
    </span>
  );
}

function Sep() {
  return <span className="text-stone-500 text-[10px]">›</span>;
}
