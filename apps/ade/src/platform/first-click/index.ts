import { listen } from "@tauri-apps/api/event";

/** The shell's event for a click that brought the window forward (`src-tauri/src/window.rs`). */
const ACTIVATED_BY_CLICK = "lervo:activated-by-click";
/**
 * How long the page waits for the click to arrive by itself before it replays it: past a usual
 * press, so a click WebKit does complete is seen first.
 */
const REPLAY_AFTER_MS = 350;
/** How close a click the page saw must be to the activation to be the same click. */
const SAME_CLICK_MS = 400;
/** How soon a press must follow an unpaired release, and how near, to be its reversed click. */
const REVERSED_WITHIN_MS = 150;
const REVERSED_WITHIN_PX = 8;
/** How long a reversed click may still complete by itself before the page presses the control. */
const REVERSED_SETTLE_MS = 60;
const CONTROLS =
  "button, a[href], [role='button'], input, textarea, select, [tabindex]:not([tabindex='-1'])";

/** Whether a click the page saw at `clickAt` is the one that activated the window. */
export function reachedPage(activatedAt: number, clickAt: number): boolean {
  return Math.abs(clickAt - activatedAt) <= SAME_CLICK_MS;
}

/** The pointer's state, as far as the page saw it. */
export interface PointerTrack {
  readonly pressed: boolean;
  /** A release that came without a press before it: the first half of a reversed click. */
  readonly unpairedUp: { readonly x: number; readonly y: number; readonly at: number } | null;
}

export const idleTrack: PointerTrack = { pressed: false, unpairedUp: null };

/**
 * Follows the pointer and finds a reversed click: right after the window becomes active, WebKit
 * can hand the page a click's release before its press, which no browser completes as a click.
 */
export function trackPointer(
  track: PointerTrack,
  kind: "down" | "up",
  x: number,
  y: number,
  at: number,
): { track: PointerTrack; reversed: boolean } {
  if (kind === "up")
    return {
      track: { pressed: false, unpairedUp: track.pressed ? null : { x, y, at } },
      reversed: false,
    };
  const up = track.unpairedUp;
  const reversed =
    up !== null &&
    at - up.at <= REVERSED_WITHIN_MS &&
    Math.hypot(x - up.x, y - up.y) <= REVERSED_WITHIN_PX;
  return { track: { pressed: true, unpairedUp: null }, reversed };
}

/** Presses the control at a place in the page, or focuses the field there. */
function pressControlAt(x: number, y: number): void {
  const target = document.elementFromPoint(x, y)?.closest(CONTROLS);
  if (!(target instanceof HTMLElement) || target.matches(":disabled")) return;
  if (target.matches("input, textarea, select")) target.focus();
  else target.click();
}

/**
 * Makes the first click act (ADE design patterns, "The first click acts"). A click that brings the
 * window forward reaches the page in one of two broken shapes, and the page completes it, unless a
 * real `click` arrives first:
 *
 * - none of it reaches the page, and the shell reports where the click activated the window;
 * - its release reaches the page before its press, so no `click` follows.
 *
 * A click on empty space or the title bar presses nothing. Returns the unbind function.
 */
export function bindFirstClick(): () => void {
  let clickAt = Number.NEGATIVE_INFINITY;
  let track = idleTrack;
  const clicked = () => {
    clickAt = performance.now();
  };
  const pointer = (kind: "down" | "up") => (event: PointerEvent) => {
    const at = performance.now();
    const next = trackPointer(track, kind, event.clientX, event.clientY, at);
    track = next.track;
    if (!next.reversed) return;
    const { clientX: x, clientY: y } = event;
    setTimeout(() => {
      if (clickAt < at) pressControlAt(x, y);
    }, REVERSED_SETTLE_MS);
  };
  const down = pointer("down");
  const up = pointer("up");
  window.addEventListener("click", clicked, true);
  window.addEventListener("pointerdown", down, true);
  window.addEventListener("pointerup", up, true);
  let stop: (() => void) | undefined;
  let unbound = false;
  void listen<{ x: number; y: number }>(ACTIVATED_BY_CLICK, ({ payload }) => {
    const activatedAt = performance.now();
    setTimeout(() => {
      if (!reachedPage(activatedAt, clickAt)) pressControlAt(payload.x, payload.y);
    }, REPLAY_AFTER_MS);
  }).then((unlisten) => {
    if (unbound) unlisten();
    else stop = unlisten;
  });
  return () => {
    unbound = true;
    window.removeEventListener("click", clicked, true);
    window.removeEventListener("pointerdown", down, true);
    window.removeEventListener("pointerup", up, true);
    stop?.();
  };
}
