import { watch } from "node:fs";

/** WAL hints include other processes. The caller owns bounded recovery and lease deadlines. */
export function watchConversationQueueChanges(
  directory: string,
  kind: "interaction" | "deliberation",
  notify: () => void,
): () => void {
  const names =
    kind === "interaction"
      ? ["interactions.sqlite"]
      : ["deliberations.sqlite", "deliberation-resumes.sqlite"];
  const allowed = new Set(names.flatMap((name) => [name, `${name}-wal`, `${name}-shm`]));
  let timer: ReturnType<typeof setTimeout> | undefined;
  const watcher = watch(directory, { persistent: false }, (_event, filename) => {
    if (filename !== null && !allowed.has(filename.toString())) return;
    if (timer === undefined)
      timer = setTimeout(() => {
        timer = undefined;
        notify();
      }, 50);
  });
  watcher.on("error", () => {
    watcher.close();
    notify();
  });
  return () => {
    watcher.close();
    if (timer !== undefined) clearTimeout(timer);
  };
}
