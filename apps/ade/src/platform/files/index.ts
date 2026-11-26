import { invoke } from "@tauri-apps/api/core";

import type { AttachedFile, Files } from "../../ports/files";

/**
 * Files through the shell: it reads copied files' paths from the system clipboard, describes
 * paths, reads a dropped image, and shows a file in Finder. Drags come from the window, which takes
 * dropped files from the webview (Lervo ADE sessions, "Files in a message").
 */
export function shellFiles(): Files {
  return {
    pasted: () => invoke<AttachedFile[]>("pasted_files"),
    describe: (paths) => invoke<AttachedFile[]>("describe_files", { paths }),
    readImage: async (path) => new Blob([await invoke<ArrayBuffer>("read_image_file", { path })]),
    reveal(path) {
      invoke("reveal_file", { path }).catch(() => undefined);
    },
    watchDrags(listener) {
      let stopped = false;
      let unlisten: (() => void) | undefined;
      // The webview module loads after the first view shows, outside the start screen's script.
      import("@tauri-apps/api/webview")
        .then(({ getCurrentWebview }) =>
          getCurrentWebview().onDragDropEvent(({ payload }) => {
            if (payload.type === "enter") listener({ kind: "enter" });
            else if (payload.type === "leave") listener({ kind: "leave" });
            else if (payload.type === "drop") listener({ kind: "drop", paths: payload.paths });
          }),
        )
        .then(
          (stop) => {
            if (stopped) stop();
            else unlisten = stop;
          },
          () => undefined,
        );
      return () => {
        stopped = true;
        unlisten?.();
      };
    },
  };
}
