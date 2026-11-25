import { invoke } from "@tauri-apps/api/core";

import type { Notifier } from "../../ports/notifier";

/**
 * Notifications through the shell, which asks the system's permission at the first one (Lervo ADE
 * sessions, "Live status and notifications"). Nothing here waits on the system, so the start screen
 * never does (ADE performance, cold start).
 */
export function tauriNotifier(): Notifier {
  return {
    notify(title, body) {
      invoke("notify", { title, body }).catch(() => undefined);
    },
  };
}
