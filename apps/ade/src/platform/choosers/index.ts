import type { Choosers } from "../../ports/choosers";

const MARK_EXTENSIONS = ["png", "jpg", "jpeg", "webp"];

const single = (value: string | string[] | null): string | null =>
  typeof value === "string" ? value : null;

/**
 * The system's open panel through the dialog plugin, loaded on first use so it stays out of the
 * first bundle (ADE performance, bundle budget).
 */
export function shellChoosers(): Choosers {
  const plugin = () => import("@tauri-apps/plugin-dialog");
  return {
    async folder(title) {
      const { open } = await plugin();
      return single(await open({ title, directory: true, multiple: false }));
    },
    async image(title) {
      const { open } = await plugin();
      return single(
        await open({
          title,
          multiple: false,
          filters: [{ name: title, extensions: MARK_EXTENSIONS }],
        }),
      );
    },
  };
}
