import { BRAND } from "@/lib/brand";
import {
  getDeviceRoleLabel,
  inferDeviceRoleFromPath,
  normalizeNextPath,
  type DeviceRole,
} from "@/lib/device-auth";
import { STORE_CONFIG } from "@/lib/store-config";

type SearchParams = Promise<{
  next?: string;
  error?: string;
  role?: string;
}>;

function isDeviceRole(value: string | undefined): value is DeviceRole {
  return (
    value === "kiosk" ||
    value === "kitchen" ||
    value === "board" ||
    value === "counter"
  );
}

export default async function DeviceLoginPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const nextPath = normalizeNextPath(sp.next, "/kiosk");
  const inferredRole = inferDeviceRoleFromPath(nextPath);
  const role =
    (isDeviceRole(sp.role) ? sp.role : inferredRole) ?? "kiosk";

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: BRAND.cream, color: BRAND.black }}
    >
      <div
        className="w-full max-w-md rounded-3xl p-8"
        style={{ background: "white", boxShadow: "0 20px 60px rgba(0,0,0,0.12)" }}
      >
        <div
          className="inline-block px-3 py-1 rounded-full text-xs font-black tracking-widest mb-4"
          style={{ background: BRAND.yellow }}
        >
          DEVICE ACCESS
        </div>
        <h1 className="display text-4xl mb-3">
          {STORE_CONFIG.storeName.toUpperCase()}
        </h1>
        <p className="text-sm opacity-70 mb-6">
          Enter the device access code to open the{" "}
          {getDeviceRoleLabel(role).toLowerCase()} surface.
        </p>

        {sp.error === "invalid" && (
          <div
            role="alert"
            className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: "#FFE3E0", color: BRAND.redDark }}
          >
            Access code was not accepted.
          </div>
        )}
        {sp.error === "locked" && (
          <div
            role="alert"
            className="mb-5 px-4 py-3 rounded-xl text-sm font-bold"
            style={{ background: "#FFE3E0", color: BRAND.redDark }}
          >
            Too many access attempts. Wait a few minutes and try again.
          </div>
        )}

        <form action="/api/device-session" method="POST" className="space-y-4">
          <input type="hidden" name="next" value={nextPath} />

          <label className="block text-xs font-black tracking-widest opacity-60">
            SURFACE
            <select
              name="role"
              defaultValue={role}
              className="block mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
            >
              <option value="kiosk">{getDeviceRoleLabel("kiosk")}</option>
              <option value="counter">{getDeviceRoleLabel("counter")}</option>
              <option value="kitchen">{getDeviceRoleLabel("kitchen")}</option>
              <option value="board">{getDeviceRoleLabel("board")}</option>
            </select>
          </label>

          <label className="block text-xs font-black tracking-widest opacity-60">
            ACCESS CODE
            <input
              type="password"
              name="password"
              className="block mt-2 w-full rounded-xl border border-stone-300 px-3 py-3 text-sm font-bold"
              autoFocus
            />
          </label>

          <button
            type="submit"
            className="btn-press w-full rounded-2xl py-4 display text-xl"
            style={{ background: BRAND.red, color: "white" }}
          >
            OPEN SURFACE
          </button>
        </form>
      </div>
    </main>
  );
}
