import * as plugin from "@tauri-apps/plugin-notification";

import type { Notifier } from "../../ports/notifier";

/**
 * Notifications through the shell's notification plugin, asking permission once. The permission
 * check is a round trip to the system, so it waits for the first notification instead of holding
 * the start screen (ADE performance, cold start).
 */
export function tauriNotifier(): Notifier {
  let allowed: Promise<boolean> | null = null;
  return {
    notify(title, body) {
      void (async () => {
        allowed ??= plugin.isPermissionGranted().catch(() => false);
        if (!(await allowed))
          allowed = plugin.requestPermission().then((permission) => permission === "granted");
        if (await allowed) plugin.sendNotification({ title, body });
      })();
    },
  };
}
