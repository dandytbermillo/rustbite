// Ref-counted body scroll lock.
//
// Multiple overlays (modals, dialogs, popovers) can stack and close in any
// order. A naïve `body.style.overflow = "hidden"` + restore-on-unmount
// pattern leaks when two overlays save each other's "hidden" as their
// "previous" value — the final unmount restores "hidden" instead of "".
//
// This module keeps a process-wide counter. The first caller captures the
// original `overflow` and applies "hidden". Subsequent callers just bump
// the counter. The counter decrements on release; when it reaches zero,
// the original value is restored.
//
// Usage:
//   useEffect(() => lockBodyScroll(), []);
//
// The returned function is the release. Call it from useEffect cleanup.

let lockCount = 0;
let originalOverflow = "";

export function lockBodyScroll(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }
  if (lockCount === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  lockCount += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    lockCount = Math.max(0, lockCount - 1);
    if (lockCount === 0) {
      document.body.style.overflow = originalOverflow;
    }
  };
}
