import { useEffect, useState } from "react";

import { motion } from "../design/generated/motion";
import { useConnectionStore } from "../features/connection";
import { useWorkspaceStore } from "../features/workspaces";
import { prefersReducedMotion } from "../platform/environment";
import type { ConnectionState } from "../ports";

/**
 * The cold-start budget (ADE performance, "Budgets"): the launch view never holds the first
 * screen longer, counted from the window's navigation start.
 */
export const launchLimitMs = 500;

export interface LaunchProgress {
  readonly connection: ConnectionState;
  /**
   * Whether the core's first lists loaded or failed. The lists kept from the last launch stand in
   * only once the budget passes, so a kept list the core no longer holds, such as projects
   * removed outside the ADE, never shows and is then replaced.
   */
  readonly listsSettled: boolean;
  /** Whether the cold-start budget has passed since the window's navigation start. */
  readonly budgetPassed: boolean;
}

/**
 * Whether the first screen may replace the launch view: its lists have loaded or failed, the
 * session host is unavailable, or the cold-start budget has passed.
 */
export function launchReady(progress: LaunchProgress): boolean {
  return progress.listsSettled || progress.connection === "unavailable" || progress.budgetPassed;
}

/**
 * Whether the first screen shows. Until it does, the launch view in `index.html` stays; then it
 * fades out over `motion.duration.exit` and leaves the document, and the answer stays true.
 */
export function useLaunched(): boolean {
  const connection = useConnectionStore((store) => store.state);
  const listsSettled = useWorkspaceStore((store) => store.loaded || store.listFailure !== null);
  const [budgetPassed, setBudgetPassed] = useState(() => performance.now() >= launchLimitMs);
  // The first screen never goes back to the launch view, even if the connection changes again.
  const [launched, setLaunched] = useState(false);
  if (!launched && launchReady({ connection, listsSettled, budgetPassed })) setLaunched(true);

  useEffect(() => {
    if (launched || budgetPassed) return;
    const timer = setTimeout(() => setBudgetPassed(true), launchLimitMs - performance.now());
    return () => clearTimeout(timer);
  }, [launched, budgetPassed]);
  useEffect(() => {
    if (launched) leaveLaunchView();
  }, [launched]);
  return launched;
}

/** Fades the launch view out and removes it; a document without one is left as it is. */
function leaveLaunchView(): void {
  const view = document.getElementById("launch");
  if (view === null || view.dataset.leaving !== undefined) return;
  performance.mark("lervo:launched");
  view.dataset.leaving = "";
  setTimeout(() => view.remove(), prefersReducedMotion() ? 0 : motion.leaveMs);
}
