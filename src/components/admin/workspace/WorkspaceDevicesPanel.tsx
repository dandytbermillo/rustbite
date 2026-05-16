"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  KeyRound,
  Monitor,
  Pencil,
  Power,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { getDeviceRoleLabel } from "@/lib/device-auth";
import type { DeviceRole } from "@/lib/device-auth";
import type {
  AdminWorkspaceDevicesSummary,
  WorkspaceDeviceRow,
} from "@/lib/admin/workspace/devices-summary";
import type { AdminWorkspaceNotify } from "./AdminWorkspaceToastHost";

const WORKSPACE_DEVICES_REFRESH_MS = 60_000;

type DeviceDraft = {
  name: string;
  physicalLocation: string;
};

type DeviceCreateForm = {
  name: string;
  physicalLocation: string;
  role: DeviceRole;
};

type WorkspaceFleetDevice = NonNullable<
  AdminWorkspaceDevicesSummary["deviceFleet"]
>["devices"][number];

const DEVICE_ROLE_OPTIONS: DeviceRole[] = ["kiosk", "counter", "kitchen", "board"];

function createFormInitial(): DeviceCreateForm {
  return {
    name: "",
    physicalLocation: "",
    role: "kiosk",
  };
}

function createFormChanged(form: DeviceCreateForm, baseline: DeviceCreateForm) {
  return (
    form.name !== baseline.name ||
    form.physicalLocation !== baseline.physicalLocation ||
    form.role !== baseline.role
  );
}

function displayFetchError(status: number, body: unknown): string {
  if (
    body &&
    typeof body === "object" &&
    "error" in body &&
    typeof body.error === "string"
  ) {
    return body.error;
  }
  return `workspace_devices_${status}`;
}

function formatGeneratedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "just now";
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatTimestamp(value: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function deviceToDraft(device: WorkspaceDeviceRow): DeviceDraft {
  return {
    name: device.name,
    physicalLocation: device.physicalLocation ?? "",
  };
}

function draftChanged(device: WorkspaceDeviceRow, draft: DeviceDraft | undefined) {
  if (!draft) return false;
  return (
    draft.name !== device.name ||
    draft.physicalLocation.trim() !== (device.physicalLocation ?? "")
  );
}

function deviceState(device: WorkspaceDeviceRow) {
  if (!device.isActive) return "disabled";
  if (!device.lastSeenAt) return "offline";

  const ageMs = Date.now() - new Date(device.lastSeenAt).getTime();
  if (Number.isNaN(ageMs)) return "offline";
  if (ageMs < 2 * 60 * 1000) return "online";
  if (ageMs < 10 * 60 * 1000) return "idle";
  return "offline";
}

function stateLabel(state: string) {
  if (state === "online") return "Online";
  if (state === "idle") return "Idle";
  if (state === "offline") return "Offline";
  return "Disabled";
}

function stateClasses(state: string) {
  if (state === "online") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (state === "idle") return "border-amber-200 bg-amber-50 text-amber-800";
  if (state === "offline") return "border-red-200 bg-red-50 text-red-800";
  return "border-stone-200 bg-stone-50 text-stone-600";
}

function stateDotClass(state: string) {
  if (state === "online") return "bg-emerald-500";
  if (state === "idle") return "bg-amber-400";
  if (state === "offline") return "bg-red-600";
  return "bg-stone-300";
}

function assignmentLabel(device: WorkspaceDeviceRow) {
  if (device.isSharedAcrossOutlets) {
    const names = device.sharedOutlets.map((outlet) => outlet.outletName);
    return names.length > 0 ? `Shared: ${names.join(", ")}` : "Shared device";
  }
  return device.outletName ?? "Assigned outlet";
}

function activeUserName(device: WorkspaceFleetDevice | null) {
  return device?.activeOperator?.displayName ?? "No active user";
}

function activeUserDetail(device: WorkspaceFleetDevice | null) {
  const operator = device?.activeOperator;
  if (!operator) return "No staff operator signed in on this device.";

  const details = [
    operator.roleLabel,
    operator.signedInAt ? `Signed in ${formatTimestamp(operator.signedInAt)}` : null,
    operator.lastActivityLabel,
  ]
    .filter(Boolean)
    .join(" · ");
  return details || "Staff operator signed in.";
}

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return body && typeof body.error === "string" ? body.error : fallback;
}

async function readActionError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null);
  return {
    errorCode:
      body && typeof body.errorCode === "string" ? body.errorCode : null,
    message: body && typeof body.error === "string" ? body.error : fallback,
  };
}

function HealthTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${stateClasses(tone)}`}>
      <div className="mono text-xl font-black text-stone-950">{value}</div>
      <div className="mt-1 text-[10px] font-black uppercase tracking-widest">
        {label}
      </div>
    </div>
  );
}

export type WorkspaceDevicesPanelVariant = "widget" | "modal";

export default function WorkspaceDevicesPanel({
  initialSummary,
  notify,
  variant = "widget",
  autoRefresh = true,
  initialDeviceId = null,
  canManageDevices: canManageDevicesOverride,
  onDirtyChange,
  onSummaryChange,
}: {
  initialSummary: AdminWorkspaceDevicesSummary;
  notify: AdminWorkspaceNotify;
  variant?: WorkspaceDevicesPanelVariant;
  autoRefresh?: boolean;
  initialDeviceId?: string | null;
  canManageDevices?: boolean;
  onDirtyChange?: (isDirty: boolean) => void;
  onSummaryChange?: (summary: AdminWorkspaceDevicesSummary) => void;
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(
    initialDeviceId && initialSummary.devices.some((device) => device.id === initialDeviceId)
      ? initialDeviceId
      : initialSummary.devices[0]?.id ?? null,
  );
  const [drafts, setDrafts] = useState<Record<string, DeviceDraft>>(() =>
    Object.fromEntries(
      initialSummary.devices.map((device) => [device.id, deviceToDraft(device)]),
    ),
  );
  const [secretDisclosure, setSecretDisclosure] = useState<{
    deviceId: string;
    label: string;
    code: string;
  } | null>(null);
  const [createSecretDisclosure, setCreateSecretDisclosure] = useState<{
    deviceId: string | null;
    label: string;
    code: string;
  } | null>(null);
  const [createFormBaseline, setCreateFormBaseline] =
    useState<DeviceCreateForm>(() => createFormInitial());
  const [createForm, setCreateForm] = useState<DeviceCreateForm>(() =>
    createFormInitial(),
  );
  const [editingDeviceId, setEditingDeviceId] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showStepUp, setShowStepUp] = useState(false);
  const [stepUpCode, setStepUpCode] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const refreshRef = useRef<
    (() => Promise<AdminWorkspaceDevicesSummary | null>) | null
  >(null);
  const editingDeviceIdRef = useRef<string | null>(null);
  const initialSummaryOutletIdRef = useRef(initialSummary.outletId);
  const onSummaryChangeRef = useRef(onSummaryChange);

  const selectedDevice = useMemo(
    () =>
      summary.devices.find((device) => device.id === selectedDeviceId) ??
      summary.devices[0] ??
      null,
    [summary.devices, selectedDeviceId],
  );
  const selectedFleetDevice = useMemo(
    () =>
      selectedDevice
        ? (summary.deviceFleet?.devices.find(
            (device) => device.id === selectedDevice.id,
          ) ?? null)
        : null,
    [summary.deviceFleet, selectedDevice],
  );
  const editingDevice = useMemo(
    () =>
      editingDeviceId
        ? (summary.devices.find((device) => device.id === editingDeviceId) ?? null)
        : null,
    [summary.devices, editingDeviceId],
  );
  const editingDraft = editingDevice
    ? (drafts[editingDevice.id] ?? deviceToDraft(editingDevice))
    : null;
  const canManageDevices =
    canManageDevicesOverride ?? summary.permissions.canManageDevices;
  const inlineEditDirty =
    variant === "modal" && editingDevice && editingDraft
      ? draftChanged(editingDevice, editingDraft)
      : false;
  const enrollmentDirty =
    variant === "modal" &&
    canManageDevices &&
    createFormChanged(createForm, createFormBaseline);
  const rootClass =
    variant === "modal"
      ? "grid content-start gap-3 bg-white"
      : "grid h-full content-start gap-3 overflow-auto bg-white";
  const detailGridClass =
    variant === "modal"
      ? "grid gap-3 lg:grid-cols-[minmax(260px,0.75fr)_minmax(420px,1.25fr)]"
      : "grid gap-3 xl:grid-cols-[minmax(280px,0.85fr)_minmax(380px,1.15fr)]";

  useEffect(() => {
    onSummaryChangeRef.current = onSummaryChange;
  }, [onSummaryChange]);

  useEffect(() => {
    const outletChanged =
      initialSummaryOutletIdRef.current !== initialSummary.outletId;
    initialSummaryOutletIdRef.current = initialSummary.outletId;
    setSummary(initialSummary);
    setRefreshError(null);
    if (outletChanged) {
      setCreateSecretDisclosure(null);
      setCreateFormBaseline(createFormInitial());
      setCreateForm(createFormInitial());
    }
    setDrafts((current) =>
      Object.fromEntries(
        initialSummary.devices.map((device) => [
          device.id,
          !outletChanged && editingDeviceIdRef.current === device.id
            ? (current[device.id] ?? deviceToDraft(device))
            : deviceToDraft(device),
        ]),
      ),
    );
    setSelectedDeviceId((current) =>
      current && initialSummary.devices.some((device) => device.id === current)
        ? current
        : initialDeviceId &&
            initialSummary.devices.some((device) => device.id === initialDeviceId)
          ? initialDeviceId
          : initialSummary.devices[0]?.id ?? null,
    );
  }, [initialDeviceId, initialSummary]);

  useEffect(() => {
    editingDeviceIdRef.current = editingDeviceId;
  }, [editingDeviceId]);

  useEffect(() => {
    onDirtyChange?.(Boolean(inlineEditDirty || enrollmentDirty));
  }, [enrollmentDirty, inlineEditDirty, onDirtyChange]);

  useEffect(() => {
    return () => onDirtyChange?.(false);
  }, [onDirtyChange]);

  useEffect(() => {
    let closed = false;

    async function refresh(): Promise<AdminWorkspaceDevicesSummary | null> {
      if (requestRef.current) return null;
      const controller = new AbortController();
      requestRef.current = controller;
      setRefreshing(true);
      let nextSummary: AdminWorkspaceDevicesSummary | null = null;
      try {
        const response = await fetch("/api/admin/workspace/devices/summary", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(displayFetchError(response.status, body));
        }
        const loadedSummary = body as AdminWorkspaceDevicesSummary;
        nextSummary = loadedSummary;
        if (!closed) {
          setSummary(loadedSummary);
          setDrafts((current) =>
            Object.fromEntries(
              loadedSummary.devices.map((device) => [
                device.id,
                editingDeviceIdRef.current === device.id
                  ? (current[device.id] ?? deviceToDraft(device))
                  : deviceToDraft(device),
              ]),
            ),
          );
          setSelectedDeviceId((current) =>
            current && loadedSummary.devices.some((device) => device.id === current)
              ? current
              : loadedSummary.devices[0]?.id ?? null,
          );
          setRefreshError(null);
          onSummaryChangeRef.current?.(loadedSummary);
        }
      } catch (error) {
        if (!controller.signal.aborted && !closed) {
          setRefreshError((error as Error).message);
        }
      } finally {
        if (requestRef.current === controller) requestRef.current = null;
        if (!closed) setRefreshing(false);
      }
      return nextSummary;
    }

    refreshRef.current = refresh;
    return () => {
      closed = true;
      requestRef.current?.abort();
      requestRef.current = null;
      if (refreshRef.current === refresh) refreshRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!autoRefresh) return;
    const pollInterval = setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void refreshRef.current?.();
    }, WORKSPACE_DEVICES_REFRESH_MS);

    function refreshWhenVisible() {
      if (document.visibilityState === "hidden") return;
      void refreshRef.current?.();
    }

    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      clearInterval(pollInterval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [autoRefresh]);

  useEffect(() => {
    if (
      editingDeviceId &&
      !summary.devices.some((device) => device.id === editingDeviceId)
    ) {
      setEditingDeviceId(null);
    }
  }, [editingDeviceId, summary.devices]);

  useEffect(() => {
    if (variant !== "widget" || !editingDeviceId) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setEditingDeviceId(null);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingDeviceId, variant]);

  function hasDirtyInlineEdit() {
    return Boolean(
      variant === "modal" &&
        editingDevice &&
        editingDraft &&
        draftChanged(editingDevice, editingDraft),
    );
  }

  function resetCreateForm() {
    const nextForm = createFormInitial();
    setCreateFormBaseline(nextForm);
    setCreateForm(nextForm);
  }

  async function handleActionError(response: Response, fallback: string) {
    const { errorCode, message } = await readActionError(response, fallback);
    if (response.status === 428 && errorCode === "mfa_enrollment_required") {
      const fullMessage = `${message} Open Security > MFA setup first.`;
      setShowStepUp(false);
      setActionError(fullMessage);
      notify({ message: fullMessage, tone: "error", durationMs: 7000 });
      return;
    }
    if (response.status === 428 && errorCode === "step_up_required") {
      const fullMessage = `${message} Verify below, then run the action again.`;
      setShowStepUp(true);
      setActionError(fullMessage);
      notify({ message: "MFA step-up required for device action.", tone: "info" });
      return;
    }
    setActionError(message);
    notify({ message, tone: "error", durationMs: 6000 });
  }

  function openDeviceEditor(device: WorkspaceDeviceRow) {
    setSecretDisclosure(null);
    setActionError(null);
    setDrafts((current) => ({
      ...current,
      [device.id]: deviceToDraft(device),
    }));
    setEditingDeviceId(device.id);
  }

  function closeDeviceEditor(device: WorkspaceDeviceRow | null) {
    if (device) {
      setDrafts((current) => ({
        ...current,
        [device.id]: deviceToDraft(device),
      }));
    }
    setEditingDeviceId(null);
  }

  function selectDevice(device: WorkspaceDeviceRow) {
    if (
      selectedDeviceId !== device.id &&
      hasDirtyInlineEdit() &&
      !window.confirm(
        "Discard unsaved device changes? Your changes will not be saved.",
      )
    ) {
      return;
    }
    if (editingDevice && editingDevice.id !== device.id) {
      closeDeviceEditor(editingDevice);
    }
    setSelectedDeviceId(device.id);
  }

  async function verifyStepUp() {
    setActionError(null);
    setPendingAction("step-up");
    const response = await fetch("/api/admin/auth/step-up", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: stepUpCode }),
    });
    setPendingAction(null);
    if (!response.ok) {
      setActionError(await readError(response, "Could not verify MFA code."));
      return;
    }
    setStepUpCode("");
    setShowStepUp(false);
    notify({
      message: "MFA verified for device actions. Run the action again.",
      tone: "info",
    });
  }

  async function saveDevice(device: WorkspaceDeviceRow) {
    const draft = drafts[device.id];
    if (!draft || !canManageDevices) return;

    setActionError(null);
    setSecretDisclosure(null);
    setPendingAction(`${device.id}:save`);
    const response = await fetch(`/api/admin/devices/${device.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: draft.name,
        physicalLocation: draft.physicalLocation,
        isActive: device.isActive,
        isSharedAcrossOutlets: device.isSharedAcrossOutlets,
        outletId: device.outletId ?? summary.outletId,
        sharedOutletIds: device.sharedOutlets.map((outlet) => outlet.outletId),
      }),
    });
    setPendingAction(null);

    if (!response.ok) {
      await handleActionError(response, "Could not update device.");
      return;
    }

    notify({ message: `Device updated: ${draft.name.trim() || device.name}` });
    setEditingDeviceId(null);
    await refreshRef.current?.();
  }

  async function createDevice() {
    if (variant !== "modal" || !canManageDevices) return;

    const name = createForm.name.trim();
    if (!name) {
      setActionError("Device name is required.");
      return;
    }

    setActionError(null);
    setSecretDisclosure(null);
    setCreateSecretDisclosure(null);
    setPendingAction("create");
    const response = await fetch("/api/admin/devices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        role: createForm.role,
        isSharedAcrossOutlets: false,
        outletId: summary.outletId,
        physicalLocation: createForm.physicalLocation,
        sharedOutletIds: [],
      }),
    });
    setPendingAction(null);

    if (!response.ok) {
      await handleActionError(response, "Could not create device.");
      return;
    }

    const body = (await response.json().catch(() => ({}))) as {
      device?: { id?: string; name?: string };
      accessCode?: string;
    };
    const createdDeviceId =
      body.device && typeof body.device.id === "string" ? body.device.id : null;
    const createdName =
      body.device && typeof body.device.name === "string" ? body.device.name : name;

    if (body.accessCode) {
      setCreateSecretDisclosure({
        deviceId: createdDeviceId,
        label: createdName,
        code: body.accessCode,
      });
    }
    resetCreateForm();
    if (createdDeviceId) setSelectedDeviceId(createdDeviceId);
    notify({ message: `Device enrolled: ${createdName}` });

    const nextSummary = await refreshRef.current?.();
    if (
      createdDeviceId &&
      nextSummary?.devices.some((device) => device.id === createdDeviceId)
    ) {
      setSelectedDeviceId(createdDeviceId);
    }
  }

  async function toggleDeviceActive(
    device: WorkspaceDeviceRow,
    nextIsActive: boolean,
  ) {
    if (!canManageDevices) return;

    setActionError(null);
    setSecretDisclosure(null);
    setPendingAction(`${device.id}:active`);
    const response = await fetch(`/api/admin/devices/${device.id}/active`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: nextIsActive }),
    });
    setPendingAction(null);

    if (!response.ok) {
      await handleActionError(response, "Could not update device state.");
      return;
    }

    notify({
      message: nextIsActive
        ? `Device enabled: ${device.name}`
        : `Device disabled: ${device.name}`,
    });
    await refreshRef.current?.();
  }

  async function rotateCode(device: WorkspaceDeviceRow) {
    if (!canManageDevices) return;

    setActionError(null);
    setSecretDisclosure(null);
    setCreateSecretDisclosure(null);
    setPendingAction(`${device.id}:rotate`);
    const response = await fetch(`/api/admin/devices/${device.id}/rotate`, {
      method: "POST",
    });
    setPendingAction(null);

    if (!response.ok) {
      await handleActionError(response, "Could not rotate access code.");
      return;
    }

    const body = (await response.json()) as { accessCode: string };
    setSecretDisclosure({
      deviceId: device.id,
      label: device.name,
      code: body.accessCode,
    });
    notify({ message: `Access code rotated: ${device.name}` });
    await refreshRef.current?.();
  }

  return (
    <div
      data-testid="workspace-devices-real-data"
      className={rootClass}
    >
      {variant === "modal" && canManageDevices && (
        <section
          data-testid="workspace-device-enrollment-section"
          className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm"
        >
          <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-stone-500">
                <KeyRound size={14} strokeWidth={2.5} aria-hidden />
                Enroll device
              </div>
              <div className="mt-1 text-sm font-semibold text-stone-500">
                {summary.outletName}
              </div>
            </div>
            {enrollmentDirty ? (
              <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-800">
                Unsaved
              </div>
            ) : (
              <div className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-stone-500">
                Ready
              </div>
            )}
          </div>

          {createSecretDisclosure && (
            <div
              data-testid="workspace-device-create-access-code"
              className="mb-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[10px] font-black uppercase tracking-widest text-amber-900">
                    Access code for {createSecretDisclosure.label}
                  </div>
                  <div className="mt-1 font-mono text-lg font-black text-amber-950">
                    {createSecretDisclosure.code}
                  </div>
                  <div className="mt-1 text-xs font-bold text-amber-900/80">
                    This raw code is only shown once.
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="workspace-device-create-access-code-dismiss"
                  onClick={() => setCreateSecretDisclosure(null)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-amber-300 bg-white text-amber-900 hover:border-amber-500"
                  aria-label="Dismiss created device access code"
                >
                  <X size={15} strokeWidth={2.5} aria-hidden />
                </button>
              </div>
            </div>
          )}

          <form
            data-no-drag="true"
            data-testid="workspace-device-enrollment-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createDevice();
            }}
            className="grid gap-3"
          >
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_180px]">
              <label className="block text-[10px] font-black uppercase tracking-widest text-stone-500">
                Device name
                <input
                  data-testid="workspace-device-enrollment-name-input"
                  value={createForm.name}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                  className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold text-stone-950"
                  placeholder="Front counter"
                />
              </label>

              <label className="block text-[10px] font-black uppercase tracking-widest text-stone-500">
                Physical location
                <input
                  data-testid="workspace-device-enrollment-location-input"
                  value={createForm.physicalLocation}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      physicalLocation: event.target.value,
                    }))
                  }
                  className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold text-stone-950"
                  placeholder="Optional"
                />
              </label>

              <label className="block text-[10px] font-black uppercase tracking-widest text-stone-500">
                Role
                <select
                  data-testid="workspace-device-enrollment-role-select"
                  value={createForm.role}
                  onChange={(event) =>
                    setCreateForm((current) => ({
                      ...current,
                      role: event.target.value as DeviceRole,
                    }))
                  }
                  className="mt-2 block w-full rounded-xl border border-stone-300 bg-white px-3 py-3 text-sm font-bold text-stone-950"
                >
                  {DEVICE_ROLE_OPTIONS.map((role) => (
                    <option key={role} value={role}>
                      {getDeviceRoleLabel(role)}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div
                data-testid="workspace-device-enrollment-outlet"
                className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-[11px] font-bold text-stone-600"
              >
                Outlet: {summary.outletName}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  data-testid="workspace-device-enrollment-reset"
                  onClick={resetCreateForm}
                  disabled={Boolean(pendingAction) || !enrollmentDirty}
                  className="rounded-full border border-stone-200 bg-white px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-400 disabled:opacity-50"
                >
                  Reset
                </button>
                <button
                  type="submit"
                  data-testid="workspace-device-enrollment-submit"
                  disabled={Boolean(pendingAction) || !createForm.name.trim()}
                  className="inline-flex items-center gap-2 rounded-full bg-stone-950 px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-yellow-300 disabled:opacity-60"
                >
                  {pendingAction === "create" ? (
                    <RefreshCw
                      size={14}
                      strokeWidth={2.5}
                      className="animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <Monitor size={14} strokeWidth={2.5} aria-hidden />
                  )}
                  Create device
                </button>
              </div>
            </div>
          </form>
        </section>
      )}

      <section className="rounded-xl border border-stone-200 bg-white p-3 shadow-sm">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-stone-500">
              <Monitor size={14} strokeWidth={2.5} aria-hidden />
              Device fleet
            </div>
            <div className="mt-1 text-sm font-semibold text-stone-500">
              {summary.outletName} · {summary.devices.length} device
              {summary.devices.length === 1 ? "" : "s"} · refreshed{" "}
              {formatGeneratedAt(summary.generatedAt)}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshRef.current?.()}
            disabled={refreshing}
            className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-400 disabled:opacity-60"
          >
            <RefreshCw
              size={12}
              strokeWidth={2.5}
              className={refreshing ? "animate-spin" : ""}
              aria-hidden
            />
            Refresh
          </button>
        </div>

        {refreshError && (
          <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">
            <AlertTriangle
              size={14}
              strokeWidth={2.5}
              className="mt-0.5 shrink-0"
              aria-hidden
            />
            <span>Device refresh failed: {refreshError}</span>
          </div>
        )}

        {actionError && (
          <div
            data-testid="workspace-device-action-error"
            className="mb-3 flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-900"
          >
            <AlertTriangle
              size={14}
              strokeWidth={2.5}
              className="mt-0.5 shrink-0"
              aria-hidden
            />
            <span>{actionError}</span>
          </div>
        )}

        {showStepUp && (
          <div
            data-testid="workspace-device-step-up"
            className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
          >
            <div className="text-xs font-black tracking-widest text-amber-900">
              MFA STEP-UP REQUIRED
            </div>
            <div className="mt-1 text-sm font-bold text-amber-900/75">
              Enter your authenticator code. After verification, click the same
              device action again.
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                data-testid="workspace-device-step-up-code"
                value={stepUpCode}
                onChange={(event) => setStepUpCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                className="w-44 rounded-md border border-stone-300 px-3 py-2 text-sm font-black tracking-widest"
              />
              <button
                type="button"
                data-testid="workspace-device-step-up-verify"
                onClick={() => void verifyStepUp()}
                disabled={pendingAction === "step-up" || stepUpCode.trim().length < 6}
                className="rounded-md bg-stone-950 px-4 py-2 text-xs font-black tracking-widest text-white disabled:opacity-50"
              >
                {pendingAction === "step-up" ? "VERIFYING..." : "VERIFY MFA"}
              </button>
              <a
                data-testid="workspace-device-mfa-setup-link"
                href="/admin/workspace?modal=security"
                className="rounded-md border border-stone-300 bg-white px-4 py-2 text-xs font-black tracking-widest"
              >
                MFA SETUP
              </a>
            </div>
          </div>
        )}

        {summary.deviceHealth ? (
          <div className="mb-3 grid gap-2 sm:grid-cols-4">
            <HealthTile label="Online" value={summary.deviceHealth.online} tone="online" />
            <HealthTile label="Idle" value={summary.deviceHealth.idle} tone="idle" />
            <HealthTile label="Offline" value={summary.deviceHealth.offline} tone="offline" />
            <HealthTile
              label="Disabled"
              value={summary.deviceHealth.disabled}
              tone="disabled"
            />
          </div>
        ) : (
          <div className="mb-3 rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-3">
            <div className="text-sm font-black text-stone-950">
              Device health hidden
            </div>
            <div className="mt-1 text-xs font-semibold text-stone-500">
              This role cannot read device status for this outlet.
            </div>
          </div>
        )}

        {summary.devices.length > 0 ? (
          <div className={detailGridClass}>
            <div className="grid content-start gap-2">
              {summary.devices.map((device) => {
                const state = deviceState(device);
                const selected = selectedDevice?.id === device.id;
                return (
                  <button
                    key={device.id}
                    type="button"
                    data-testid={`workspace-device-row-${device.id}`}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => selectDevice(device)}
                    className={`rounded-xl border bg-white p-3 text-left transition hover:border-stone-400 ${
                      selected
                        ? "border-stone-900 shadow-[0_0_0_3px_rgba(255,190,11,0.18)]"
                        : "border-stone-200"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-black text-stone-950">
                          {device.name}
                        </div>
                        <div className="mt-1 text-[11px] font-bold text-stone-500">
                          {getDeviceRoleLabel(device.role)} ·{" "}
                          {assignmentLabel(device)}
                        </div>
                      </div>
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${stateClasses(
                          state,
                        )}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${stateDotClass(
                            state,
                          )}`}
                        />
                        {stateLabel(state)}
                      </span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-semibold text-stone-500">
                      <span>Last seen {formatTimestamp(device.lastSeenAt)}</span>
                      <span>·</span>
                      <span>{device.activeSessionCount} live session{device.activeSessionCount === 1 ? "" : "s"}</span>
                    </div>
                  </button>
                );
              })}
            </div>

            {selectedDevice && (
              <div
                data-testid="workspace-device-detail"
                className="rounded-xl border border-stone-200 bg-stone-50 p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
                      Device detail
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <div className="text-xl font-black text-stone-950">
                        {selectedDevice.name}
                      </div>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${stateClasses(
                          deviceState(selectedDevice),
                        )}`}
                      >
                        {stateLabel(deviceState(selectedDevice))}
                      </span>
                    </div>
                    <div className="mt-1 text-xs font-bold text-stone-500">
                      {getDeviceRoleLabel(selectedDevice.role)} ·{" "}
                      {assignmentLabel(selectedDevice)}
                    </div>
                  </div>
                  {!canManageDevices && (
                    <div className="rounded-lg border border-dashed border-stone-300 bg-white px-3 py-2 text-[11px] font-bold text-stone-500">
                      Management actions require device manage permission.
                    </div>
                  )}
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="rounded-lg border border-stone-200 bg-white px-3 py-2">
                    <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
                      Device name
                    </div>
                    <div
                      data-testid="workspace-device-name-value"
                      className="mt-1 text-sm font-bold text-stone-700"
                    >
                      {selectedDevice.name}
                    </div>
                  </div>

                  <div
                    data-testid="workspace-device-active-user"
                    className="rounded-lg border border-stone-200 bg-white px-3 py-2"
                  >
                    <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
                      Current user
                    </div>
                    <div className="mt-1 text-sm font-bold text-stone-700">
                      {activeUserName(selectedFleetDevice)}
                    </div>
                    <div className="mt-1 text-[11px] font-semibold text-stone-500">
                      {activeUserDetail(selectedFleetDevice)}
                    </div>
                  </div>

                  {[
                    ["Role", getDeviceRoleLabel(selectedDevice.role)],
                    ["Last seen", formatTimestamp(selectedDevice.lastSeenAt)],
                    ["Rotated", formatTimestamp(selectedDevice.rotatedAt)],
                    ["Created", formatTimestamp(selectedDevice.createdAt)],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-stone-200 bg-white px-3 py-2"
                    >
                      <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
                        {label}
                      </div>
                      <div className="mt-1 text-sm font-bold text-stone-700">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>

                {secretDisclosure?.deviceId === selectedDevice.id && (
                  <div
                    data-testid="workspace-device-access-code"
                    className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"
                  >
                    <div className="text-[10px] font-black uppercase tracking-widest text-amber-900">
                      Access code for {secretDisclosure.label}
                    </div>
                    <div className="mt-1 font-mono text-lg font-black text-amber-950">
                      {secretDisclosure.code}
                    </div>
                    <div className="mt-1 text-xs font-bold text-amber-900/80">
                      This raw code is only shown once.
                    </div>
                  </div>
                )}

                {canManageDevices && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                    <button
                      type="button"
                      data-testid="workspace-device-toggle-active"
                      onClick={() =>
                        void toggleDeviceActive(
                          selectedDevice,
                          !selectedDevice.isActive,
                        )
                      }
                      disabled={Boolean(pendingAction)}
                      className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-widest text-stone-800 hover:border-stone-400 disabled:opacity-60"
                    >
                      <Power size={14} strokeWidth={2.5} aria-hidden />
                      {pendingAction === `${selectedDevice.id}:active`
                        ? "Updating..."
                        : selectedDevice.isActive
                          ? "Disable"
                          : "Enable"}
                    </button>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        data-testid="workspace-device-rotate-code"
                        onClick={() => void rotateCode(selectedDevice)}
                        disabled={Boolean(pendingAction)}
                        className="inline-flex items-center gap-2 rounded-full border border-stone-200 bg-white px-4 py-2 text-[11px] font-black uppercase tracking-widest text-stone-800 hover:border-stone-400 disabled:opacity-60"
                      >
                        <KeyRound size={14} strokeWidth={2.5} aria-hidden />
                        {pendingAction === `${selectedDevice.id}:rotate`
                          ? "Rotating..."
                          : "Rotate code"}
                      </button>
                      <button
                        type="button"
                        data-testid="workspace-device-edit"
                        onClick={() => openDeviceEditor(selectedDevice)}
                        disabled={Boolean(pendingAction)}
                        className="inline-flex items-center gap-2 rounded-full bg-stone-950 px-4 py-2 text-[11px] font-black uppercase tracking-widest text-yellow-300 disabled:opacity-60"
                      >
                        <Pencil size={14} strokeWidth={2.5} aria-hidden />
                        Edit device
                      </button>
                    </div>
                  </div>
                )}

                {canManageDevices && !pendingAction && (
                  <div className="mt-3 inline-flex items-center gap-2 text-[11px] font-bold text-stone-500">
                    <CheckCircle2 size={13} strokeWidth={2.5} aria-hidden />
                    Uses secured device management routes and permission checks.
                  </div>
                )}

                {variant === "modal" &&
                  editingDevice?.id === selectedDevice.id &&
                  editingDraft &&
                  canManageDevices && (
                    <form
                      data-no-drag="true"
                      data-testid="workspace-device-inline-editor"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void saveDevice(editingDevice);
                      }}
                      className="mt-4 rounded-xl border border-stone-200 bg-white"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 px-4 py-3">
                        <div>
                          <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
                            Edit device
                          </div>
                        </div>
                        {draftChanged(editingDevice, editingDraft) ? (
                          <div className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-amber-800">
                            Unsaved
                          </div>
                        ) : (
                          <div className="rounded-full border border-stone-200 bg-stone-50 px-3 py-1 text-[10px] font-black uppercase tracking-widest text-stone-500">
                            No changes
                          </div>
                        )}
                      </div>
                      <div className="grid gap-4 px-4 py-4 sm:grid-cols-2">
                        <label className="block text-[10px] font-black uppercase tracking-widest text-stone-500">
                          Device name
                          <input
                            data-testid="workspace-device-editor-name-input"
                            value={editingDraft.name}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [editingDevice.id]: {
                                  ...deviceToDraft(editingDevice),
                                  ...current[editingDevice.id],
                                  name: event.target.value,
                                },
                              }))
                            }
                            className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold text-stone-950"
                            autoFocus
                          />
                        </label>

                        <label className="block text-[10px] font-black uppercase tracking-widest text-stone-500">
                          Physical location
                          <input
                            data-testid="workspace-device-editor-location-input"
                            value={editingDraft.physicalLocation}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [editingDevice.id]: {
                                  ...deviceToDraft(editingDevice),
                                  ...current[editingDevice.id],
                                  physicalLocation: event.target.value,
                                },
                              }))
                            }
                            className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold text-stone-950"
                            placeholder="No physical location set"
                          />
                        </label>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-4 py-3">
                        {draftChanged(editingDevice, editingDraft) ? (
                          <div className="text-[11px] font-bold text-amber-700">
                            Unsaved device details
                          </div>
                        ) : (
                          <div className="text-[11px] font-bold text-stone-500">
                            No device detail changes
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            data-testid="workspace-device-editor-cancel"
                            onClick={() => closeDeviceEditor(editingDevice)}
                            className="rounded-full border border-stone-200 bg-white px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-400"
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            data-testid="workspace-device-editor-save"
                            disabled={Boolean(pendingAction)}
                            className="inline-flex items-center gap-2 rounded-full bg-stone-950 px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-yellow-300 disabled:opacity-60"
                          >
                            {pendingAction === `${editingDevice.id}:save` ? (
                              <RefreshCw
                                size={14}
                                strokeWidth={2.5}
                                className="animate-spin"
                                aria-hidden
                              />
                            ) : (
                              <Save size={14} strokeWidth={2.5} aria-hidden />
                            )}
                            Save changes
                          </button>
                        </div>
                      </div>
                    </form>
                  )}
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 px-3 py-6 text-center">
            <div className="text-sm font-black text-stone-950">
              No devices assigned
            </div>
            <div className="mt-1 text-xs font-semibold text-stone-500">
              Devices for this outlet will appear here after enrollment.
            </div>
          </div>
        )}
      </section>

      {variant === "widget" && editingDevice && editingDraft && canManageDevices && (
        <div
          data-testid="workspace-device-editor-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="workspace-device-editor-title"
          className="fixed inset-0 z-[120] flex items-center justify-center bg-stone-950/60 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDeviceEditor(editingDevice);
            }
          }}
        >
          <form
            data-no-drag="true"
            onSubmit={(event) => {
              event.preventDefault();
              void saveDevice(editingDevice);
            }}
            className="max-h-[min(760px,92vh)] w-full max-w-2xl overflow-auto rounded-2xl border border-stone-200 bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-stone-200 px-5 py-4">
              <div>
                <div
                  id="workspace-device-editor-title"
                  className="text-[11px] font-black uppercase tracking-widest text-stone-500"
                >
                  Edit device
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <div className="text-2xl font-black text-stone-950">
                    {editingDevice.name}
                  </div>
                  <span
                    className={`rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-widest ${stateClasses(
                      deviceState(editingDevice),
                    )}`}
                  >
                    {stateLabel(deviceState(editingDevice))}
                  </span>
                </div>
                <div className="mt-1 text-xs font-bold text-stone-500">
                  {getDeviceRoleLabel(editingDevice.role)} ·{" "}
                  {assignmentLabel(editingDevice)}
                </div>
              </div>
              <button
                type="button"
                data-testid="workspace-device-editor-close"
                onClick={() => closeDeviceEditor(editingDevice)}
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-200 bg-white text-stone-700 hover:border-stone-400"
                aria-label="Close device editor"
              >
                <X size={18} strokeWidth={2.5} aria-hidden />
              </button>
            </div>

            <div className="grid gap-4 px-5 py-5 sm:grid-cols-2">
              <label className="block text-[10px] font-black uppercase tracking-widest text-stone-500">
                Device name
                <input
                  data-testid="workspace-device-editor-name-input"
                  value={editingDraft.name}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [editingDevice.id]: {
                        ...deviceToDraft(editingDevice),
                        ...current[editingDevice.id],
                        name: event.target.value,
                      },
                    }))
                  }
                  className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold text-stone-950"
                  autoFocus
                />
              </label>

              <label className="block text-[10px] font-black uppercase tracking-widest text-stone-500">
                Physical location
                <input
                  data-testid="workspace-device-editor-location-input"
                  value={editingDraft.physicalLocation}
                  onChange={(event) =>
                    setDrafts((current) => ({
                      ...current,
                      [editingDevice.id]: {
                        ...deviceToDraft(editingDevice),
                        ...current[editingDevice.id],
                        physicalLocation: event.target.value,
                      },
                    }))
                  }
                  className="mt-2 block w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold text-stone-950"
                  placeholder="No physical location set"
                />
              </label>

              <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
                  Role
                </div>
                <div className="mt-1 text-sm font-bold text-stone-700">
                  {getDeviceRoleLabel(editingDevice.role)}
                </div>
              </div>

              <div className="rounded-xl border border-stone-200 bg-stone-50 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-stone-500">
                  Last seen
                </div>
                <div className="mt-1 text-sm font-bold text-stone-700">
                  {formatTimestamp(editingDevice.lastSeenAt)}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 px-5 py-4">
              {draftChanged(editingDevice, editingDraft) ? (
                <div className="text-[11px] font-bold text-amber-700">
                  Unsaved device details
                </div>
              ) : (
                <div className="text-[11px] font-bold text-stone-500">
                  No device detail changes
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => closeDeviceEditor(editingDevice)}
                  className="rounded-full border border-stone-200 bg-white px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-stone-700 hover:border-stone-400"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  data-testid="workspace-device-editor-save"
                  disabled={Boolean(pendingAction)}
                  className="inline-flex items-center gap-2 rounded-full bg-stone-950 px-5 py-2.5 text-[11px] font-black uppercase tracking-widest text-yellow-300 disabled:opacity-60"
                >
                  {pendingAction === `${editingDevice.id}:save` ? (
                    <RefreshCw
                      size={14}
                      strokeWidth={2.5}
                      className="animate-spin"
                      aria-hidden
                    />
                  ) : (
                    <Save size={14} strokeWidth={2.5} aria-hidden />
                  )}
                  Save changes
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
