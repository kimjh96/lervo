// What the interface needs to know about the platform it runs on, read in one place.

/**
 * Whether the interface runs on macOS, where the command modifier is Command and the shell
 * draws the native window material (`tauri.macos.conf.json`) behind the webview.
 */
export const isMac = typeof navigator !== "undefined" && navigator.userAgent.includes("Mac OS");

const reducedMotionQuery =
  typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

/** Whether the OS asks for reduced motion now; the answer follows the setting as it changes. */
export function prefersReducedMotion(): boolean {
  return reducedMotionQuery?.matches === true;
}
