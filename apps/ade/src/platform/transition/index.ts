import { flushSync } from "react-dom";

const reducedMotion =
  typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;

/**
 * Changes the view with a continuity transition (ADE motion, "Continuity"): elements that carry
 * the same `view-transition-name` before and after, such as the reply card, move and resize to
 * their new place, and the rest crossfades. `update` runs synchronously, so the new view exists
 * when the transition captures it. Without view transitions, or under reduced motion, the view
 * changes at once.
 */
export function transition(update: () => void): void {
  if (
    typeof document === "undefined" ||
    !("startViewTransition" in document) ||
    reducedMotion?.matches === true
  ) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}
