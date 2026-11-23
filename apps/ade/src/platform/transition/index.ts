import { flushSync } from "react-dom";

import { prefersReducedMotion } from "../environment";

/**
 * Changes the view between the start screen and a workspace with a view transition (ADE motion,
 * "Changing views"): the leaving view fades out and the arriving view fades in and rises.
 * `update` runs synchronously, so the new view exists when the transition captures it. Without
 * view transitions, or under reduced motion, the view changes at once.
 */
export function transition(update: () => void): void {
  if (
    typeof document === "undefined" ||
    !("startViewTransition" in document) ||
    prefersReducedMotion()
  ) {
    update();
    return;
  }
  document.startViewTransition(() => flushSync(update));
}
