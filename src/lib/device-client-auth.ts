export function redirectToDeviceLogin(nextPath: string) {
  if (typeof window === "undefined") return;
  window.location.assign(`/device-login?next=${encodeURIComponent(nextPath)}`);
}
