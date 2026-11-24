import { listen } from "@tauri-apps/api/event";

/** The shell's event for a click that brought the window forward (`src-tauri/src/window.rs`). */
const ACTIVATED_BY_CLICK = "lervo:activated-by-click";
/** How long the page waits for the click to arrive by itself before it replays it. */
const REPLAY_AFTER_MS = 150;
/** How close a press of the page's own must be to the activation to be the same click. */
const SAME_CLICK_MS = 400;
const CONTROLS =
  "button, a[href], [role='button'], input, textarea, select, [tabindex]:not([tabindex='-1'])";

/** Whether a press the page saw at `pressAt` is the click that activated the window. */
export function reachedPage(activatedAt: number, pressAt: number): boolean {
  return Math.abs(pressAt - activatedAt) <= SAME_CLICK_MS;
}

/**
 * Makes the first click act (ADE design patterns, "The first click acts"). WebKit spends a click
 * that brings the window forward on activating it, so the page never sees it; the shell reports
 * that click's place, and the page presses the control there, or focuses the field, unless the
 * click reached the page after all. A click on empty space or the title bar does nothing.
 * Returns the unbind function.
 */
export function bindFirstClick(): () => void {
  let pressAt = Number.NEGATIVE_INFINITY;
  const press = () => {
    pressAt = performance.now();
  };
  window.addEventListener("pointerdown", press, true);
  let stop: (() => void) | undefined;
  let unbound = false;
  void listen<{ x: number; y: number }>(ACTIVATED_BY_CLICK, ({ payload }) => {
    const activatedAt = performance.now();
    setTimeout(() => {
      if (reachedPage(activatedAt, pressAt)) return;
      const target = document.elementFromPoint(payload.x, payload.y)?.closest(CONTROLS);
      if (!(target instanceof HTMLElement) || target.matches(":disabled")) return;
      if (target.matches("input, textarea, select")) target.focus();
      else target.click();
    }, REPLAY_AFTER_MS);
  }).then((unlisten) => {
    if (unbound) unlisten();
    else stop = unlisten;
  });
  return () => {
    unbound = true;
    window.removeEventListener("pointerdown", press, true);
    stop?.();
  };
}
