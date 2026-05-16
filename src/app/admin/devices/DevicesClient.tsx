"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Info } from "lucide-react";
import { getDeviceRoleLabel, type DeviceRole } from "@/lib/device-auth";
import type { AdminOutletRow } from "@/lib/admin-user-management";
import type { DeviceRow } from "@/lib/device-management";
import { DEFAULT_OUTLET_ID } from "@/lib/outlets";

const DEFAULT_PHYSICAL_LOCATION = "Cafeteria";
const PHYSICAL_LOCATION_EXAMPLES = [
  "front counter in cafeteria",
  "restaurant kitchen",
  "cafeteria pickup",
  "hallway board",
  "office",
  "temporary event table in cafeteria",
] as const;

type DeviceDraft = {
  name: string;
  physicalLocation: string;
  isActive: boolean;
};

type CreateForm = {
  name: string;
  physicalLocation: string;
  role: DeviceRole;
};

function blankCreateForm(): CreateForm {
  return {
    name: "",
    physicalLocation: DEFAULT_PHYSICAL_LOCATION,
    role: "kiosk",
  };
}

function deviceToDraft(device: DeviceRow): DeviceDraft {
  return {
    name: device.name,
    physicalLocation: device.physicalLocation ?? "",
    isActive: device.isActive,
  };
}

function outletScopeLabel(device: DeviceRow): string {
  return device.outletName ?? "Cafeteria";
}

function formatTimestamp(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return body && typeof body.error === "string" ? body.error : fallback;
}

function hasNonActiveDraftChanges(device: DeviceRow, draft: DeviceDraft): boolean {
  if (draft.name !== device.name) return true;
  if (draft.physicalLocation.trim() !== (device.physicalLocation ?? "")) return true;
  return false;
}

function PhysicalLocationLabel({
  helpId,
  openHelpId,
  setOpenHelpId,
}: {
  helpId: string;
  openHelpId: string | null;
  setOpenHelpId: (value: string | null) => void;
}) {
  const isOpen = openHelpId === helpId;
  return (
    <span className="relative inline-flex items-center gap-2">
      <span>PHYSICAL LOCATION</span>
      <button
        type="button"
        aria-label="Show physical location examples"
        title="Show examples"
        onClick={() => setOpenHelpId(isOpen ? null : helpId)}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-stone-300 text-stone-600"
      >
        <Info size={13} strokeWidth={3} />
      </button>
      {isOpen && (
        <span className="absolute left-0 top-7 z-20 w-72 rounded-lg border border-stone-200 bg-white p-3 text-left text-[11px] font-bold normal-case tracking-normal text-stone-700 shadow-lg">
          <span className="mb-2 block text-[10px] font-black uppercase tracking-widest text-stone-500">
            Examples
          </span>
          {PHYSICAL_LOCATION_EXAMPLES.map((example) => (
            <span key={example} className="block py-0.5">
              {example}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

export default function DevicesClient({
  initialDevices,
  outlets: _outlets,
}: {
  initialDevices: DeviceRow[];
  outlets: AdminOutletRow[];
}) {
  const router = useRouter();
  const [devices, setDevices] = useState(initialDevices);
  const [drafts, setDrafts] = useState<Record<string, DeviceDraft>>(() =>
    Object.fromEntries(
      initialDevices.map((device) => [device.id, deviceToDraft(device)])
    )
  );
  const [createForm, setCreateForm] = useState(() => blankCreateForm());
  const [stepUpCode, setStepUpCode] = useState("");
  const [showStepUp, setShowStepUp] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [secretDisclosure, setSecretDisclosure] = useState<{
    deviceId: string | null;
    label: string;
    code: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openLocationHelpId, setOpenLocationHelpId] = useState<string | null>(null);
  const [isRefreshing, startRefresh] = useTransition();

  const deviceCountLabel = useMemo(
    () => `${devices.length} device${devices.length === 1 ? "" : "s"}`,
    [devices.length]
  );

  const refresh = () => {
    startRefresh(async () => {
      const response = await fetch("/api/admin/devices", { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as {
        devices: DeviceRow[];
        outlets: AdminOutletRow[];
      };
      setDevices(body.devices);
      setDrafts(
        Object.fromEntries(
          body.devices.map((device) => [device.id, deviceToDraft(device)])
        )
      );
      router.refresh();
    });
  };

  const clearMessages = () => {
    setError(null);
    setNotice(null);
  };

  const handleSensitiveActionError = async (
    response: Response,
    fallback: string
  ) => {
    const body = await response.json().catch(() => null);
    const errorCode =
      body && typeof body.errorCode === "string" ? body.errorCode : null;
    const message = body && typeof body.error === "string" ? body.error : fallback;
    if (response.status === 428 && errorCode === "mfa_enrollment_required") {
      setError(`${message} Open Security > MFA setup first.`);
      return;
    }
    if (response.status === 428 && errorCode === "step_up_required") {
      setShowStepUp(true);
      setError(`${message} Verify below, then run the action again.`);
      return;
    }
    setError(message);
  };

  const verifyStepUp = async () => {
    clearMessages();
    setPendingId("step-up");
    const response = await fetch("/api/admin/auth/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: stepUpCode }),
    });
    setPendingId(null);
    if (!response.ok) {
      setError(await readError(response, "Could not verify MFA code."));
      return;
    }
    setStepUpCode("");
    setShowStepUp(false);
    setNotice("MFA verified for device actions. Run the action again.");
  };

  const createDevice = async (event: React.FormEvent) => {
    event.preventDefault();
    clearMessages();
    setSecretDisclosure(null);
    setPendingId("create");

    const response = await fetch("/api/admin/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: createForm.name,
        role: createForm.role,
        isSharedAcrossOutlets: false,
        outletId: DEFAULT_OUTLET_ID,
        physicalLocation: createForm.physicalLocation,
        sharedOutletIds: [],
      }),
    });

    setPendingId(null);
    if (!response.ok) {
      await handleSensitiveActionError(response, "Could not create device.");
      return;
    }

    const body = (await response.json()) as {
      device: DeviceRow;
      accessCode: string;
    };
    setCreateForm(blankCreateForm());
    setNotice("Device enrolled.");
    setSecretDisclosure({
      deviceId: body.device.id,
      label: body.device.name,
      code: body.accessCode,
    });
    refresh();
  };

  const saveDevice = async (device: DeviceRow) => {
    clearMessages();
    setSecretDisclosure(null);
    setPendingId(device.id);
    const draft = drafts[device.id];
    const response = await fetch(`/api/admin/devices/${device.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        physicalLocation: draft.physicalLocation,
        isActive: draft.isActive,
        isSharedAcrossOutlets: false,
        outletId: DEFAULT_OUTLET_ID,
        sharedOutletIds: [],
      }),
    });
    setPendingId(null);
    if (!response.ok) {
      await handleSensitiveActionError(response, "Could not update device.");
      return;
    }
    setNotice("Device updated.");
    refresh();
  };

  const rotateCode = async (device: DeviceRow) => {
    clearMessages();
    setSecretDisclosure(null);
    setPendingId(`${device.id}:rotate`);
    const response = await fetch(`/api/admin/devices/${device.id}/rotate`, {
      method: "POST",
    });
    setPendingId(null);
    if (!response.ok) {
      await handleSensitiveActionError(response, "Could not rotate access code.");
      return;
    }
    const body = (await response.json()) as { accessCode: string };
    setNotice("Access code rotated. Existing device sessions were revoked.");
    setSecretDisclosure({
      deviceId: device.id,
      label: device.name,
      code: body.accessCode,
    });
    refresh();
  };

  const toggleDeviceActive = async (device: DeviceRow, nextIsActive: boolean) => {
    clearMessages();
    setSecretDisclosure(null);

    const draft = drafts[device.id];
    if (!draft) return;

    if (hasNonActiveDraftChanges(device, draft)) {
      setError(
        "Save or clear the other device changes before changing Active."
      );
      return;
    }

    setDrafts((prev) => ({
      ...prev,
      [device.id]: {
        ...prev[device.id],
        isActive: nextIsActive,
      },
    }));

    setPendingId(`${device.id}:active`);
    const response = await fetch(`/api/admin/devices/${device.id}/active`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: nextIsActive }),
    });
    setPendingId(null);

    if (!response.ok) {
      setDrafts((prev) => ({
        ...prev,
        [device.id]: {
          ...prev[device.id],
          isActive: device.isActive,
        },
      }));
      await handleSensitiveActionError(response, "Could not update device state.");
      return;
    }

    setNotice(
      nextIsActive
        ? "Device enabled. Sign in again on that device to open the surface."
        : "Device disabled. Existing device sessions were revoked."
    );
    refresh();
  };

  return (
    <div>
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="display text-3xl">Devices</h1>
          <div className="mt-2 text-xs font-black tracking-widest opacity-60">
            Enroll physical kiosks, boards, counters, and kitchen screens.
          </div>
        </div>
        <div className="text-xs font-black tracking-widest opacity-60">
          {deviceCountLabel}
        </div>
      </div>

      <form
        onSubmit={createDevice}
        className="mb-6 rounded-xl border border-stone-200 bg-white p-5"
      >
        <div className="mb-4 text-xs font-black tracking-widest opacity-60">
          ENROLL DEVICE
        </div>
        <div className="grid gap-3 lg:grid-cols-[1.2fr_1fr_180px]">
          <label className="block text-[10px] font-black tracking-widest opacity-70">
            DEVICE NAME
            <input
              value={createForm.name}
              onChange={(event) =>
                setCreateForm((prev) => ({ ...prev, name: event.target.value }))
              }
              className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
              placeholder="Counter iPad 1"
            />
          </label>

          <label className="block text-[10px] font-black tracking-widest opacity-70">
            <PhysicalLocationLabel
              helpId="create-location"
              openHelpId={openLocationHelpId}
              setOpenHelpId={setOpenLocationHelpId}
            />
            <input
              value={createForm.physicalLocation}
              onChange={(event) =>
                setCreateForm((prev) => ({
                  ...prev,
                  physicalLocation: event.target.value,
                }))
              }
              className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
              placeholder="Cafeteria"
            />
          </label>

          <label className="block text-[10px] font-black tracking-widest opacity-70">
            ROLE
            <select
              value={createForm.role}
              onChange={(event) =>
                setCreateForm((prev) => ({
                  ...prev,
                  role: event.target.value as DeviceRole,
                }))
              }
              className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
            >
              <option value="kiosk">{getDeviceRoleLabel("kiosk")}</option>
              <option value="counter">{getDeviceRoleLabel("counter")}</option>
              <option value="kitchen">{getDeviceRoleLabel("kitchen")}</option>
              <option value="board">{getDeviceRoleLabel("board")}</option>
            </select>
          </label>
        </div>

        <div className="mt-4 flex items-center justify-end">
          <button
            type="submit"
            disabled={pendingId === "create"}
            className="rounded-full px-5 py-3 text-xs font-black tracking-widest text-white disabled:opacity-50"
            style={{ background: "#d44735" }}
          >
            {pendingId === "create" ? "CREATING…" : "CREATE DEVICE"}
          </button>
        </div>
      </form>

      {notice && (
        <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-900">
          {notice}
        </div>
      )}
      {error && (
        <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-bold text-rose-900">
          {error}
        </div>
      )}
      {isRefreshing && (
        <div className="mb-4 text-xs font-black tracking-widest opacity-60">
          REFRESHING…
        </div>
      )}
      {showStepUp && (
        <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <div className="text-xs font-black tracking-widest text-amber-900">
            MFA STEP-UP REQUIRED
          </div>
          <div className="mt-1 text-sm font-bold text-amber-900/75">
            Enter your authenticator code. After verification, click the same
            device action again.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              value={stepUpCode}
              onChange={(event) => setStepUpCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              className="w-44 rounded-md border border-stone-300 px-3 py-2 text-sm font-black tracking-widest"
            />
            <button
              type="button"
              onClick={verifyStepUp}
              disabled={pendingId === "step-up" || stepUpCode.trim().length < 6}
              className="rounded-md px-4 py-2 text-xs font-black tracking-widest disabled:opacity-50"
              style={{ background: "#171717", color: "white" }}
            >
              {pendingId === "step-up" ? "VERIFYING..." : "VERIFY MFA"}
            </button>
            <a
              href="/admin/workspace?modal=security"
              className="rounded-md border border-stone-300 bg-white px-4 py-2 text-xs font-black tracking-widest"
            >
              MFA SETUP
            </a>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {devices.map((device) => {
          const draft = drafts[device.id];
          const disclosedSecret =
            secretDisclosure?.deviceId === device.id ? secretDisclosure : null;
          const hasDirtyNonActiveChanges = hasNonActiveDraftChanges(device, draft);
          const isStateTogglePending = pendingId === `${device.id}:active`;
          const isRotatePending = pendingId === `${device.id}:rotate`;
          const isSavePending = pendingId === device.id;
          return (
            <section
              key={device.id}
              className="rounded-xl border border-stone-200 bg-white p-5"
            >
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="display text-2xl">{device.name}</div>
                  <div className="mt-1 text-xs font-black tracking-widest opacity-60">
                    {getDeviceRoleLabel(device.role).toUpperCase()} ·{" "}
                    {outletScopeLabel(device).toUpperCase()}
                  </div>
                  <div className="mt-1 text-xs font-bold text-stone-500">
                    {device.physicalLocation
                      ? `Location: ${device.physicalLocation}`
                      : "No physical location set"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className="rounded-full px-3 py-1 text-xs font-black tracking-widest"
                    style={{
                      background: device.isActive ? "#dcfce7" : "#f5f5f4",
                      color: device.isActive ? "#166534" : "#57534e",
                    }}
                  >
                    {device.isActive ? "ACTIVE" : "DISABLED"}
                  </span>
                  <span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-black tracking-widest text-stone-700">
                    {device.activeSessionCount} LIVE SESSION
                    {device.activeSessionCount === 1 ? "" : "S"}
                  </span>
                </div>
              </div>

              <div className="grid gap-3 lg:grid-cols-[1fr_1fr_220px]">
                <label className="block text-[10px] font-black tracking-widest opacity-70">
                  DEVICE NAME
                  <input
                    value={draft.name}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [device.id]: {
                          ...prev[device.id],
                          name: event.target.value,
                        },
                      }))
                    }
                    className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
                  />
                </label>

                <label className="block text-[10px] font-black tracking-widest opacity-70">
                  <PhysicalLocationLabel
                    helpId={`${device.id}-location`}
                    openHelpId={openLocationHelpId}
                    setOpenHelpId={setOpenLocationHelpId}
                  />
                  <input
                    value={draft.physicalLocation}
                    onChange={(event) =>
                      setDrafts((prev) => ({
                        ...prev,
                        [device.id]: {
                          ...prev[device.id],
                          physicalLocation: event.target.value,
                        },
                      }))
                    }
                    className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
                    placeholder="No physical location set"
                  />
                </label>

                <div className="rounded-xl border border-stone-200 px-4 py-3">
                  <div className="text-[10px] font-black tracking-widest opacity-60">
                    ROLE
                  </div>
                  <div className="mt-1 text-sm font-bold">
                    {getDeviceRoleLabel(device.role)}
                  </div>
                  <div className="mt-3 text-[10px] font-black tracking-widest opacity-60">
                    LAST SEEN
                  </div>
                  <div className="mt-1 text-sm font-bold">
                    {formatTimestamp(device.lastSeenAt)}
                  </div>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-[11px] font-black tracking-widest opacity-70">
                  <input
                    type="checkbox"
                    checked={draft.isActive}
                    disabled={isStateTogglePending || isRotatePending || isSavePending}
                    onChange={(event) =>
                      void toggleDeviceActive(device, event.target.checked)
                    }
                  />
                  {isStateTogglePending ? "UPDATING ACTIVE…" : "ACTIVE"}
                </label>

                <div className="flex flex-wrap items-center gap-2">
                  {hasDirtyNonActiveChanges && (
                    <div className="text-[11px] font-bold text-amber-700">
                      Unsaved device details
                    </div>
                  )}
                  <div className="text-[11px] font-bold opacity-60">
                    Rotated {formatTimestamp(device.rotatedAt)} · Created{" "}
                    {formatTimestamp(device.createdAt)}
                  </div>
                  <button
                    type="button"
                    onClick={() => rotateCode(device)}
                    disabled={isRotatePending || isStateTogglePending || isSavePending}
                    className="rounded-full border border-stone-300 px-4 py-2 text-[11px] font-black tracking-widest disabled:opacity-50"
                  >
                    {isRotatePending ? "ROTATING…" : "ROTATE CODE"}
                  </button>
                  <button
                    type="button"
                    onClick={() => saveDevice(device)}
                    disabled={isSavePending || isRotatePending || isStateTogglePending}
                    className="rounded-full px-4 py-2 text-[11px] font-black tracking-widest text-white disabled:opacity-50"
                    style={{ background: "#d44735" }}
                  >
                    {isSavePending ? "SAVING…" : "SAVE DEVICE"}
                  </button>
                </div>
              </div>

              {disclosedSecret && (
                <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-4">
                  <div className="text-xs font-black tracking-widest text-amber-900">
                    ACCESS CODE FOR {disclosedSecret.label.toUpperCase()}
                  </div>
                  <div className="mt-2 font-mono text-lg font-bold text-amber-950">
                    {disclosedSecret.code}
                  </div>
                  <div className="mt-2 text-sm font-bold text-amber-900/80">
                    Copy this now. The raw code is not shown again after this response.
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
