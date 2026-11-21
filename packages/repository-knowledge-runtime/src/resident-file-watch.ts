import { existsSync, watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";

/** One look after an ancestor watch is armed, once its event stream is surely running. */
const WATCH_START_RECHECK_MILLISECONDS = 2_000;

/**
 * ADR-0602: notifies when any of `paths` is written, renamed into place or removed, through one
 * kernel watch per parent directory. A directory that does not exist yet is covered by a watch on
 * its nearest existing ancestor, which re-arms one level closer each time the next directory on
 * the way appears, and notifies once the target directory is watched, since its files may have
 * arrived with it. It returns the directories no ancestor could cover, so the caller can report
 * them; a watch that fails later notifies once and closes.
 */
export function watchFiles(
  paths: readonly string[],
  notify: () => void,
  onFailure: (error: unknown) => void = () => undefined,
  /** Directories any change below which notifies, watched recursively. */
  trees: readonly string[] = [],
): { stop(): void; unwatched: string[] } {
  const unwatched: string[] = [];
  const recursiveDirectories = new Set(trees);
  const byDirectory = new Map<string, Set<string> | null>();
  for (const tree of trees) byDirectory.set(tree, null);
  for (const path of paths) {
    if (byDirectory.get(dirname(path)) === null) continue;
    const names = byDirectory.get(dirname(path)) ?? new Set<string>();
    names.add(basename(path));
    byDirectory.set(dirname(path), names);
  }
  const watchers = new Set<FSWatcher>();
  const rechecks = new Set<NodeJS.Timeout>();
  let closed = false;
  const open = (
    directory: string,
    listener: (name: string | null) => void,
    recursive = false,
    /** Re-arms after the watched directory itself was removed or its watch failed. */
    rearm?: () => void,
  ): FSWatcher | "missing" | "failed" => {
    try {
      let ended = false;
      const end = () => {
        if (ended) return false;
        ended = true;
        watcher.close();
        watchers.delete(watcher);
        return !closed;
      };
      const watcher = watch(directory, { persistent: false, recursive }, (_event, name) => {
        if (closed || ended) return;
        // ADR-0602: a removed directory ends its watch silently; re-arm toward it instead.
        if (rearm !== undefined && !existsSync(directory)) {
          if (end()) rearm();
          return;
        }
        listener(name === null ? null : name.toString());
      });
      watcher.on("error", (error) => {
        if (!end()) return;
        onFailure(error);
        notify();
        // One fresh watch; a failure to open it is reported by `open` itself.
        rearm?.();
      });
      watchers.add(watcher);
      return watcher;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
      onFailure(error);
      return "failed";
    }
  };
  // Watches `directory`, or the nearest ancestor that exists for the next directory on the way.
  const arm = (directory: string, names: Set<string> | null, appeared: boolean): boolean => {
    const target = open(
      directory,
      (name) => {
        if (names === null || name === null || names.has(name)) notify();
      },
      recursiveDirectories.has(directory),
      () => {
        // Its files went with it.
        notify();
        arm(directory, names, true);
      },
    );
    if (target !== "missing") {
      if (target !== "failed" && appeared) notify();
      return target !== "failed";
    }
    let child = directory;
    let ancestor = dirname(directory);
    while (ancestor !== child) {
      const step = basename(child);
      const next = child;
      // Replaced once the watch exists; an event before that cannot arrive synchronously.
      let descend = () => undefined as void;
      const watcher = open(ancestor, (name) => {
        if (name === null || name === step) descend();
      });
      if (watcher === "failed") return false;
      if (watcher !== "missing") {
        let descended = false;
        descend = () => {
          if (descended || closed) return;
          descended = true;
          watcher.close();
          watchers.delete(watcher);
          arm(directory, names, true);
        };
        // The next directory may have appeared between the miss and this watch, or, on macOS,
        // before the watch's event stream started (it starts on another thread); one look now
        // and one once the stream is surely running cover both. Armed only while it is missing.
        if (existsSync(next)) descend();
        else {
          const recheck = setTimeout(() => {
            if (existsSync(next)) descend();
          }, WATCH_START_RECHECK_MILLISECONDS);
          recheck.unref();
          rechecks.add(recheck);
        }
        return true;
      }
      child = ancestor;
      ancestor = dirname(ancestor);
    }
    return false;
  };
  for (const [directory, names] of byDirectory)
    if (!arm(directory, names, false)) unwatched.push(directory);
  return {
    stop: () => {
      closed = true;
      for (const watcher of watchers) watcher.close();
      watchers.clear();
      for (const recheck of rechecks) clearTimeout(recheck);
      rechecks.clear();
    },
    unwatched,
  };
}
