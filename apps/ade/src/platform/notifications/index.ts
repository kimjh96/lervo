import type { Notifier } from "../../ports/notifier";

/** Notifications through the shell's notification plugin, asking permission once. */
export async function tauriNotifier(): Promise<Notifier> {
  const plugin = await import("@tauri-apps/plugin-notification");
  let allowed = await plugin.isPermissionGranted();
  return {
    notify(title, body) {
      void (async () => {
        if (!allowed) allowed = (await plugin.requestPermission()) === "granted";
        if (allowed) plugin.sendNotification({ title, body });
      })();
    },
  };
}
