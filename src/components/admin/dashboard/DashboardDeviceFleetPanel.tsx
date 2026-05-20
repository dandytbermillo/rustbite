"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AdminDashboardSummary } from "@/lib/admin/dashboard/summary";
import { EmptyPanel } from "@/components/admin/dashboard/DashboardPresentation";

type DashboardDeviceFleet = NonNullable<AdminDashboardSummary["deviceFleet"]>;
type DashboardDevice = DashboardDeviceFleet["devices"][number];

function deviceStateClasses(state: DashboardDevice["state"]): string {
  if (state === "online") return "border-emerald-200 bg-white text-emerald-700";
  if (state === "idle") return "border-amber-200 bg-amber-50 text-amber-700";
  if (state === "offline") return "border-red-200 bg-red-50 text-red-700";
  return "border-stone-200 bg-stone-50 text-stone-500";
}

function deviceStateDotClass(state: DashboardDevice["state"]): string {
  if (state === "online") return "bg-emerald-500";
  if (state === "idle") return "bg-amber-400";
  if (state === "offline") return "bg-red-600";
  return "bg-stone-300";
}

function deviceStateLabel(state: DashboardDevice["state"]): string {
  if (state === "online") return "Online";
  if (state === "idle") return "Idle";
  if (state === "offline") return "Offline";
  return "Disabled";
}

function devicePresenceLabel(device: DashboardDevice): string {
  return device.presenceLabel ?? deviceStateLabel(device.state);
}

function detailValue(value: string | null | undefined): string {
  return value && value.trim() ? value : "Not recorded";
}

function formatOperatorTime(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DashboardDeviceFleetPanel({
  deviceHealth,
  href,
  deviceFleet,
  showManageLink = true,
}: {
  deviceHealth: NonNullable<AdminDashboardSummary["deviceHealth"]>;
  href: string | null;
  deviceFleet: AdminDashboardSummary["deviceFleet"];
  showManageLink?: boolean;
}) {
  const [selectedTone, setSelectedTone] = useState<string | null>(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const fleetDevices = deviceFleet?.devices ?? [];
  const hasFleetDevices = fleetDevices.length > 0;
  const manageHref = deviceFleet?.manageHref ?? href;
  const selectedDevice =
    fleetDevices.find((device) => device.id === selectedDeviceId) ?? null;

  useEffect(() => {
    if (!selectedDeviceId) return;
    if (fleetDevices.some((device) => device.id === selectedDeviceId)) {
      return;
    }
    setSelectedDeviceId(null);
  }, [fleetDevices, selectedDeviceId]);

  const tiles = [
    {
      label: "ONLINE",
      value: deviceHealth.online,
      seen: "Last seen < 2 min",
      tone: "online",
    },
    {
      label: "IDLE",
      value: deviceHealth.idle,
      seen: "Idle 2-10 min",
      tone: "idle",
    },
    {
      label: "OFFLINE",
      value: deviceHealth.offline,
      seen: "Offline > 10 min",
      tone: "offline",
    },
    {
      label: "DISABLED",
      value: deviceHealth.disabled,
      seen: "Disabled",
      tone: "disabled",
    },
  ];
  const selectedTile = tiles.find((tile) => tile.tone === selectedTone) ?? null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap gap-3 text-[13px] font-bold text-stone-700">
          <span>
            <span className="mono font-black text-stone-950">
              {deviceHealth.online}
            </span>{" "}
            online
          </span>
          <span>
            <span className="mono font-black text-stone-950">
              {deviceHealth.idle}
            </span>{" "}
            idle
          </span>
          <span>
            <span className="mono font-black text-stone-950">
              {deviceHealth.offline}
            </span>{" "}
            offline
          </span>
          <span>
            <span className="mono font-black text-stone-950">
              {deviceHealth.disabled}
            </span>{" "}
            disabled
          </span>
        </div>
        {showManageLink && manageHref && (
          <Link
            href={manageHref}
            className="rounded-full bg-stone-950 px-3 py-2 text-[11px] font-black tracking-widest text-yellow-300 uppercase"
          >
            Manage devices
          </Link>
        )}
      </div>
      <div className="mono mb-3 text-[11px] font-bold tracking-wide text-stone-500">
        Online &lt; 2 min · Idle 2-10 min · Offline &gt; 10 min
      </div>
      {hasFleetDevices ? (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {fleetDevices.map((device) => {
              const isSelected = selectedDeviceId === device.id;
              return (
                <button
                  key={device.id}
                  type="button"
                  onClick={() => {
                    setSelectedTone(null);
                    setSelectedDeviceId(device.id);
                  }}
                  data-testid={`dashboard-device-tile-${device.id}`}
                  aria-expanded={isSelected}
                  aria-controls="dashboard-device-detail"
                  className={`rounded-[10px] border p-3 text-left transition hover:-translate-y-px hover:border-stone-300 ${
                    isSelected
                      ? "shadow-[0_0_0_3px_rgba(255,190,11,0.2)] "
                      : ""
                  }${deviceStateClasses(device.state)}`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="mono min-w-0 truncate text-[12px] font-black tracking-wide">
                      {device.name}
                    </div>
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${deviceStateDotClass(
                        device.state,
                      )}`}
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[12px] font-semibold text-stone-600">
                    <span>{device.roleLabel}</span>
                    <span className="text-stone-300">·</span>
                    <span>{device.lastSeenLabel}</span>
                  </div>
                  {device.physicalLocation && (
                    <div className="mt-1 truncate text-[12px] font-bold text-stone-500">
                      {device.physicalLocation}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          {selectedDevice && (
            <div
              id="dashboard-device-detail"
              data-testid="dashboard-device-detail"
              className="mt-3 rounded-xl border border-stone-200 border-l-yellow-400 bg-stone-50 p-3"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black tracking-widest text-stone-500 uppercase">
                    Device detail
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <span className="text-lg font-black text-stone-950">
                      {selectedDevice.name}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[10px] font-black tracking-widest uppercase ${deviceStateClasses(
                        selectedDevice.state,
                      )}`}
                    >
                      {devicePresenceLabel(selectedDevice)}
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-stone-500">
                    {selectedDevice.roleLabel} · {selectedDevice.lastSeenLabel}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedDeviceId(null)}
                  className="rounded-full bg-white px-3 py-2 text-[11px] font-black tracking-widest text-stone-700 uppercase hover:bg-stone-100"
                >
                  Close
                </button>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {(
                  [
                    ["Screen", selectedDevice.screen],
                    ["Presence", devicePresenceLabel(selectedDevice)],
                    ["Session", selectedDevice.session],
                    [
                      "Active operator",
                      selectedDevice.activeOperator
                        ? [
                            selectedDevice.activeOperator.displayName,
                            selectedDevice.activeOperator.roleLabel,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "No staff operator active",
                    ],
                    [
                      "Operator activity",
                      selectedDevice.activeOperator
                        ? [
                            `Signed in ${formatOperatorTime(
                              selectedDevice.activeOperator.signedInAt,
                            )}`,
                            selectedDevice.activeOperator.lastActivityLabel,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : "Device session only",
                    ],
                    ["Assignment", selectedDevice.assignmentLabel],
                    ["Location", selectedDevice.physicalLocation],
                  ] as Array<[string, string | null]>
                ).map(([label, value]) => (
                  <div
                    key={label}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-2"
                  >
                    <div className="text-[10px] font-black tracking-widest text-stone-500 uppercase">
                      {label}
                    </div>
                    <div className="mt-1 text-sm font-bold text-stone-700">
                      {detailValue(value)}
                    </div>
                  </div>
                ))}
              </div>
              {selectedDevice.note && (
                <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm font-black text-amber-900">
                  {selectedDevice.note}
                </div>
              )}
            </div>
          )}
        </>
      ) : deviceFleet ? (
        <EmptyPanel
          title="No connected devices"
          body="No active or inactive devices are assigned to this outlet yet."
        />
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {tiles.map((tile) => {
              const isSelected = selectedTone === tile.tone;
              return (
                <button
                  key={tile.label}
                  type="button"
                  onClick={() => {
                    setSelectedDeviceId(null);
                    setSelectedTone(tile.tone);
                  }}
                  data-testid={`dashboard-device-health-tile-${tile.tone}`}
                  aria-expanded={isSelected}
                  aria-controls="dashboard-device-detail"
                  className={`rounded-[10px] border p-3 text-left transition hover:-translate-y-px hover:border-stone-300 ${
                    isSelected
                      ? "shadow-[0_0_0_3px_rgba(255,190,11,0.2)] "
                      : ""
                  }${
                    tile.tone === "online"
                      ? "border-emerald-200 bg-white"
                      : tile.tone === "idle"
                        ? "border-amber-200 bg-amber-50"
                        : tile.tone === "offline"
                          ? "border-red-200 bg-red-50"
                          : "border-stone-200 bg-stone-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div
                      className={`mono text-[12px] font-black tracking-wide ${
                        tile.tone === "online"
                          ? "text-emerald-700"
                          : tile.tone === "idle"
                            ? "text-amber-700"
                            : tile.tone === "offline"
                              ? "text-red-700"
                              : "text-stone-500"
                      }`}
                    >
                      {tile.label}-{tile.value}
                    </div>
                    <span
                      className={`h-2 w-2 rounded-full ${
                        tile.tone === "online"
                          ? "bg-emerald-500"
                          : tile.tone === "idle"
                            ? "bg-amber-400"
                            : tile.tone === "offline"
                              ? "bg-red-600"
                              : "bg-stone-300"
                      }`}
                    />
                  </div>
                  <div className="mt-2 text-[12px] font-semibold text-stone-600">
                    {tile.seen}
                  </div>
                </button>
              );
            })}
          </div>
          {selectedTile && (
            <div
              id="dashboard-device-detail"
              data-testid="dashboard-device-detail"
              className="mt-3 rounded-xl border border-stone-200 border-l-yellow-400 bg-stone-50 p-3"
              aria-live="polite"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] font-black tracking-widest text-stone-500 uppercase">
                    Device detail
                  </div>
                  <div className="mt-1 text-lg font-black text-stone-950">
                    Fleet detail pending
                  </div>
                  <div className="text-sm font-semibold text-stone-500">
                    {selectedTile.label.toLowerCase()} aggregate selected.
                    Individual device tiles need the dashboard device fleet
                    contract.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedTone(null)}
                  className="rounded-full bg-white px-3 py-2 text-[11px] font-black tracking-widest text-stone-700 uppercase hover:bg-stone-100"
                >
                  Close
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
