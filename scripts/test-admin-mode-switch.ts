/* eslint-disable no-console */
import assert from "node:assert/strict";
import {
  adminModeFromSearchParams,
  adminModePreferenceHref,
  isSafeAdminModeRedirect,
  parseAdminMode,
  resolveAdminModePreference,
} from "@/lib/admin/mode-preference";
import { classicDeepLinkToWorkspaceTarget } from "@/lib/admin/workspace/deep-links";

function cookieReader(value: string | undefined) {
  return {
    get(name: string) {
      if (name !== "rb_admin_mode" || value === undefined) return undefined;
      return { value };
    },
  };
}

function main() {
  assert.equal(parseAdminMode("workspace"), "workspace");
  assert.equal(parseAdminMode("classic"), "classic");
  assert.equal(parseAdminMode("invalid"), null);

  assert.equal(
    adminModeFromSearchParams(new URLSearchParams("mode=workspace")),
    "workspace",
    "explicit workspace mode should parse from URL",
  );

  assert.equal(
    resolveAdminModePreference({
      searchParams: new URLSearchParams("mode=classic"),
      cookies: cookieReader("workspace"),
    }),
    "classic",
    "explicit URL mode must override stored preference",
  );

  assert.equal(
    resolveAdminModePreference({
      searchParams: new URLSearchParams(),
      cookies: cookieReader("workspace"),
    }),
    "workspace",
    "stored mode should be used when URL mode is absent",
  );

  assert.equal(
    resolveAdminModePreference({
      searchParams: new URLSearchParams(),
      cookies: cookieReader(undefined),
    }),
    "classic",
    "rollout fallback should keep Classic unless preference is set",
  );

  assert.equal(
    adminModePreferenceHref({
      mode: "workspace",
      next: "/admin/workspace?widget=orders",
    }),
    "/api/admin/mode?mode=workspace&next=%2Fadmin%2Fworkspace%3Fwidget%3Dorders",
    "mode switch href should persist mode through the route handler",
  );

  assert.equal(isSafeAdminModeRedirect("/admin/orders"), true);
  assert.equal(isSafeAdminModeRedirect("/admin/workspace?widget=menu"), true);
  assert.equal(isSafeAdminModeRedirect("https://example.test/admin"), false);
  assert.equal(isSafeAdminModeRedirect("//admin"), false);
  assert.equal(isSafeAdminModeRedirect("/kiosk"), false);

  assert.equal(
    classicDeepLinkToWorkspaceTarget({
      pathname: "/admin/orders",
      searchParams: new URLSearchParams("id=order-123"),
    }),
    null,
    "Classic order links should stay Classic unless mode=workspace is explicit",
  );

  assert.equal(
    classicDeepLinkToWorkspaceTarget({
      pathname: "/admin/orders",
      searchParams: new URLSearchParams(
        "mode=workspace&id=order-123&status=READY",
      ),
    }),
    "/admin/workspace?widget=orders&order=order-123&status=READY",
    "explicit workspace order deep link should preserve target order and status",
  );

  assert.equal(
    classicDeepLinkToWorkspaceTarget({
      pathname: "/admin/menu",
      searchParams: new URLSearchParams(
        "mode=workspace&id=item-123&q=burger&category=burgers&category=deals&badge=HOT&status=hidden&stock=out&attention=deals&attention=inventory-out",
      ),
    }),
    "/admin/workspace?widget=menu&item=item-123&q=burger&category=burgers&category=deals&badge=HOT&status=hidden&stock=out&attention=deals&attention=inventory-out",
    "explicit workspace menu deep link should preserve the full menu filter state",
  );

  assert.equal(
    classicDeepLinkToWorkspaceTarget({
      pathname: "/admin/devices",
      searchParams: new URLSearchParams("mode=workspace&id=device-123"),
    }),
    "/admin/workspace?widget=devices&device=device-123",
    "explicit workspace device deep link should preserve target device",
  );

  console.log("Admin mode switch tests passed.");
}

main();
