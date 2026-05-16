"use client";

import { BRAND } from "@/lib/brand";

type Props = {
  isActive: boolean;
  isOutOfStock: boolean;
  onIsActiveChange: (next: boolean) => void;
  onOutOfStockChange: (next: boolean) => void;
  // Deal modals show an expiration date input here too; non-deal omits it.
  expirationSlot?: React.ReactNode;
  // Deal modals omit the Live/Hidden toggle — visibility for deals is driven
  // by the footer "Hide deal" / "Show deal" button + the header status pill,
  // and the inline toggle would be redundant. Non-deal modals keep it.
  omitLiveToggle?: boolean;
  omitStockToggle?: boolean;
  // When the row has no toggles to explain (e.g., deals omit both), the
  // help paragraph is dead chrome — pass true to drop it entirely.
  omitHelpText?: boolean;
  stockDisabled?: boolean;
  liveControlLabel?: string;
  stockControlLabel?: string;
  stockLabel?: string;
  stockAriaLabel?: string;
  stockHelp?: React.ReactNode;
  canWrite?: boolean;
};

export default function VisibilityRow({
  isActive,
  isOutOfStock,
  onIsActiveChange,
  onOutOfStockChange,
  expirationSlot,
  omitLiveToggle = false,
  omitStockToggle = false,
  omitHelpText = false,
  stockDisabled = false,
  liveControlLabel,
  stockControlLabel,
  stockLabel,
  stockAriaLabel,
  stockHelp,
  canWrite = true,
}: Props) {
  const readOnlyTitle = !canWrite ? "Read-only access" : undefined;
  const stockToggleDisabled = stockDisabled || !canWrite;

  return (
    <div
      className="flex flex-wrap items-start gap-4 px-4 py-3.5 rounded-2xl border border-stone-200"
      style={{ background: BRAND.cream }}
    >
      {!omitLiveToggle && (
        <div className="flex min-w-[220px] flex-col gap-1.5">
          {liveControlLabel && (
            <span className="text-[10px] font-black uppercase tracking-widest text-stone-500">
              {liveControlLabel}
            </span>
          )}
          <span
            className="inline-flex w-fit bg-white border border-stone-200 rounded-full p-[3px]"
            title={readOnlyTitle}
          >
            <ToggleBtn
              active={isActive}
              onClick={() => onIsActiveChange(true)}
              disabled={!canWrite}
              title={readOnlyTitle}
            >
              Live
            </ToggleBtn>
            <ToggleBtn
              active={!isActive}
              onClick={() => onIsActiveChange(false)}
              disabled={!canWrite}
              title={readOnlyTitle}
            >
              Hidden
            </ToggleBtn>
          </span>
        </div>
      )}

      {!omitStockToggle && (
        <div className="flex min-w-[240px] flex-col gap-1.5" title={readOnlyTitle}>
          {stockControlLabel && (
            <span className="text-[10px] font-black uppercase tracking-widest text-stone-500">
              {stockControlLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              if (!stockToggleDisabled) onOutOfStockChange(!isOutOfStock);
            }}
            disabled={stockToggleDisabled}
            className={`inline-flex w-fit items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 py-2 text-[10px] font-black uppercase tracking-widest transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0 ${
              isOutOfStock
                ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                : "border-red-200 bg-red-50 text-red-800"
            }`}
            aria-label={
              stockAriaLabel ?? (isOutOfStock ? "Mark in stock" : "Mark out of stock")
            }
          >
            {stockLabel ?? (isOutOfStock ? "Mark in stock" : "Mark out of stock")}
          </button>
        </div>
      )}

      {expirationSlot && <div className="w-full">{expirationSlot}</div>}

      {!omitHelpText && (
        <p className="basis-full text-xs text-stone-500">
          {!omitLiveToggle && (
            <>
              <strong className="text-stone-700">Hidden</strong> items don&apos;t appear on the
              kiosk.{" "}
            </>
          )}
          {stockHelp ?? (
            <>
              <strong className="text-stone-700">Out of stock</strong> items stay visible with an
              &quot;OUT OF STOCK&quot; badge but cannot be added to an order.
            </>
          )}
        </p>
      )}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
  disabled,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="px-3.5 py-1.5 rounded-full text-[11px] font-black tracking-widest uppercase transition-colors disabled:cursor-not-allowed disabled:opacity-70"
      style={
        active
          ? { background: BRAND.black, color: BRAND.yellow }
          : { color: "#78716c" }
      }
    >
      {children}
    </button>
  );
}
