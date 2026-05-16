import type { DeviceSessionActor } from "@/lib/device-sessions";

export function getDeviceMenuOutletId(actor: DeviceSessionActor): string | null {
  if (actor.activeOutletId && actor.allowedOutletIds.includes(actor.activeOutletId)) {
    return actor.activeOutletId;
  }

  if (actor.outletId && actor.allowedOutletIds.includes(actor.outletId)) {
    return actor.outletId;
  }

  return actor.allowedOutletIds[0] ?? null;
}
