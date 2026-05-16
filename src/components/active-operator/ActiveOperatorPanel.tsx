"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Phase 3: Active operator panel for counter/kitchen surfaces.
//
// Renders a compact header strip showing who is currently signed in as
// the active operator on this device, with a Sign in / Switch operator
// button that opens a modal for picking a user and entering their PIN.
//
// The component is self-contained: it fetches `/api/device-session/staff`
// on mount, polls every 30 s to pick up idle-expiry / cascade clears
// triggered by admin actions, and re-fetches after a successful switch
// or clear. Parents can subscribe to active-operator state via the
// `onChange` callback to gate their action buttons.

export type EligibleOperator = {
  id: string;
  displayName: string;
  accountType: string;
  outletRole: string;
  surface: string;
  pinSetState: "SET" | "NOT_SET";
};

export type ActiveOperator = {
  id: string;
  displayName: string;
  accountType: string | null;
  outletId: string | null;
  outletRole: string | null;
  grantedSurface: string;
  verifiedAt: string | null;
  lastActionAt: string | null;
};

type StatusResponse = {
  device: {
    id: string;
    name: string;
    role: string;
    isSharedAcrossOutlets: boolean;
    primaryOutletId: string | null;
    activeOutletId: string | null;
    allowedOutletIds: string[];
    requiredSurface: string;
  };
  requiresActiveOutlet: boolean;
  activeOperator: ActiveOperator | null;
  eligibleOperators: EligibleOperator[];
};

type SwitchPhase =
  | { kind: "closed" }
  | { kind: "select" }
  | { kind: "pin"; staff: EligibleOperator };

const POLL_MS = 30_000;

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

export default function ActiveOperatorPanel({
  onChange,
  surfaceLabel,
  refreshKey,
}: {
  onChange?: (op: ActiveOperator | null) => void;
  surfaceLabel: string;
  /**
   * When this value changes, the panel re-fetches active-operator status.
   * Used by parent pages to surface a cleared-operator state immediately
   * after they receive a 403 from a downstream API (idle expiry, role
   * revoke, etc.) without waiting for the next poll.
   */
  refreshKey?: number;
}) {
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<SwitchPhase>({ kind: "closed" });
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/device-session/staff", { cache: "no-store" });
      if (!res.ok) {
        if (aliveRef.current) {
          setError(`status ${res.status}`);
          setStatus(null);
        }
        return;
      }
      const body = (await res.json()) as StatusResponse;
      if (!aliveRef.current) return;
      setStatus(body);
      setError(null);
      onChange?.(body.activeOperator);
    } catch (err) {
      if (aliveRef.current) setError((err as Error).message);
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, [onChange]);

  useEffect(() => {
    aliveRef.current = true;
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => {
      aliveRef.current = false;
      clearInterval(timer);
    };
  }, [refresh]);

  // Allow parent pages to force an immediate re-fetch when downstream
  // APIs report a stale operator (e.g. 403 from order PATCH).
  useEffect(() => {
    if (refreshKey !== undefined) {
      refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const onSelect = (staff: EligibleOperator) => {
    if (staff.pinSetState !== "SET") {
      setPinError("This user has no operational PIN configured. Ask an Owner to set one.");
      return;
    }
    setPhase({ kind: "pin", staff });
    setPin("");
    setPinError(null);
  };

  const onSubmitPin = async () => {
    if (phase.kind !== "pin") return;
    if (pin.length < 6) {
      setPinError("Enter the 6–8 digit PIN.");
      return;
    }
    setSubmitting(true);
    setPinError(null);
    try {
      const res = await fetch("/api/device-session/staff/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          staffUserId: phase.staff.id,
          pin,
        }),
      });
      if (res.status === 429) {
        const body = (await res.json().catch(() => ({}))) as {
          retryAfterSeconds?: number;
        };
        setPinError(
          `Too many attempts. Try again in ${body.retryAfterSeconds ?? 60}s.`
        );
        return;
      }
      if (!res.ok) {
        setPinError("Credentials rejected. Check the PIN and try again.");
        return;
      }
      setPhase({ kind: "closed" });
      setPin("");
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const onClear = async () => {
    setSubmitting(true);
    try {
      await fetch("/api/device-session/staff/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      await refresh();
    } finally {
      setSubmitting(false);
    }
  };

  const eligibleSorted = useMemo(() => {
    return [...(status?.eligibleOperators ?? [])].sort((a, b) =>
      a.displayName.localeCompare(b.displayName)
    );
  }, [status?.eligibleOperators]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-black/40 px-4 py-3 mb-4 text-white">
        <div className="flex flex-col gap-0.5">
          <div className="text-[10px] font-black tracking-widest opacity-60">
            ACTIVE OPERATOR · {surfaceLabel}
          </div>
          {status?.activeOperator ? (
            <div className="flex items-baseline gap-3">
              <span className="display text-xl">
                {status.activeOperator.displayName}
              </span>
              <span className="text-xs font-bold tracking-widest opacity-70">
                {status.activeOperator.outletRole}{" "}
                {status.activeOperator.accountType
                  ? `· ${status.activeOperator.accountType}`
                  : ""}
              </span>
              {status.activeOperator.lastActionAt && (
                <span className="text-[10px] opacity-50">
                  last action {relativeTime(status.activeOperator.lastActionAt)}
                </span>
              )}
            </div>
          ) : (
            <div className="text-sm font-bold opacity-80">No active operator</div>
          )}
          {error && (
            <div className="text-[10px] font-black tracking-widest text-red-300">
              {error}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setPhase({ kind: "select" })}
            disabled={loading || submitting}
            className="rounded-xl bg-yellow-400 px-4 py-2 text-xs font-black tracking-widest text-black disabled:opacity-50"
          >
            {status?.activeOperator ? "SWITCH OPERATOR" : "SIGN IN"}
          </button>
          {status?.activeOperator && (
            <button
              type="button"
              onClick={onClear}
              disabled={submitting}
              className="rounded-xl border border-white/30 px-4 py-2 text-xs font-black tracking-widest text-white disabled:opacity-50"
            >
              SIGN OUT
            </button>
          )}
        </div>
      </div>

      {phase.kind !== "closed" && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.7)" }}
          onClick={() =>
            !submitting && setPhase({ kind: "closed" })
          }
        >
          <div
            className="w-full max-w-md rounded-2xl bg-white p-6 text-stone-900"
            onClick={(event) => event.stopPropagation()}
          >
            {phase.kind === "select" && (
              <>
                <div className="mb-3 text-xs font-black tracking-widest opacity-60">
                  SIGN IN AS OPERATOR
                </div>
                <div className="display text-2xl mb-4">Pick your name</div>
                {status?.requiresActiveOutlet && (
                  <div className="mb-3 rounded-md bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900">
                    Shared device requires an active outlet selection. Ask an admin
                    to set this device's outlet before signing in.
                  </div>
                )}
                {eligibleSorted.length === 0 ? (
                  <div className="rounded-md border border-stone-300 bg-stone-50 px-3 py-4 text-sm font-bold text-stone-600">
                    No eligible operators. An Owner must grant {status?.device.requiredSurface ?? ""} surface
                    access and assign a Manager/Operator outlet role.
                  </div>
                ) : (
                  <ul className="max-h-72 space-y-1 overflow-y-auto">
                    {eligibleSorted.map((op) => (
                      <li key={op.id}>
                        <button
                          type="button"
                          onClick={() => onSelect(op)}
                          disabled={submitting}
                          className="flex w-full items-center justify-between gap-3 rounded-md border border-stone-300 px-3 py-2 text-left hover:bg-stone-50 disabled:opacity-50"
                        >
                          <span className="flex flex-col">
                            <span className="font-black">{op.displayName}</span>
                            <span className="text-xs font-bold tracking-widest opacity-60">
                              {op.outletRole} · {op.accountType}
                            </span>
                          </span>
                          {op.pinSetState !== "SET" && (
                            <span className="rounded-md bg-stone-200 px-2 py-1 text-[10px] font-black tracking-widest text-stone-600">
                              NO PIN
                            </span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => setPhase({ kind: "closed" })}
                    className="rounded-md border border-stone-300 px-4 py-2 text-xs font-black tracking-widest"
                  >
                    CANCEL
                  </button>
                </div>
              </>
            )}
            {phase.kind === "pin" && (
              <>
                <div className="mb-3 text-xs font-black tracking-widest opacity-60">
                  ENTER PIN
                </div>
                <div className="display text-2xl mb-1">
                  Signing in as {phase.staff.displayName}
                </div>
                <div className="text-xs font-bold tracking-widest opacity-60 mb-4">
                  {phase.staff.outletRole} · {phase.staff.accountType}
                </div>
                <input
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  autoFocus
                  value={pin}
                  onChange={(event) =>
                    setPin(event.target.value.replace(/\D/g, "").slice(0, 8))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !submitting) onSubmitPin();
                  }}
                  className="w-full rounded-md border border-stone-300 px-4 py-3 text-xl font-black tracking-[0.4em] text-center"
                  placeholder="••••••"
                />
                {pinError && (
                  <div className="mt-2 rounded-md bg-red-100 px-3 py-2 text-sm font-bold text-red-700">
                    {pinError}
                  </div>
                )}
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setPhase({ kind: "select" })}
                    disabled={submitting}
                    className="rounded-md border border-stone-300 px-4 py-2 text-xs font-black tracking-widest disabled:opacity-50"
                  >
                    BACK
                  </button>
                  <button
                    type="button"
                    onClick={onSubmitPin}
                    disabled={submitting || pin.length < 6}
                    className="rounded-md bg-black px-4 py-2 text-xs font-black tracking-widest text-white disabled:opacity-50"
                  >
                    {submitting ? "VERIFYING..." : "VERIFY"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Helper: derive a "why disabled" reason for action buttons. Returns a
 * human-readable string when the action should be disabled, or null when
 * the operator is set and the action can proceed.
 */
export function whyOperatorActionDisabled(
  operator: ActiveOperator | null,
  surface: "COUNTER" | "KITCHEN"
): string | null {
  if (!operator) {
    return surface === "COUNTER"
      ? "Sign in as operator to perform counter actions"
      : "Sign in as operator to update orders";
  }
  return null;
}
