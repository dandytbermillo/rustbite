export const KIOSK_SURFACE_SEARCH = "surface=kiosk";

export function isKioskSurfaceRequest(searchParams: URLSearchParams): boolean {
  return searchParams.get("surface") === "kiosk";
}
