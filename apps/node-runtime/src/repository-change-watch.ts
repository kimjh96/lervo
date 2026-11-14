import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  classifyRepositoryChange,
  type RepositoryChangeScope,
} from "./repository-change-classification.js";
import { listRepositoryChangeDirectories } from "./repository-change-directories.js";
import { observeRepositoryChangeHint } from "./repository-change-observation.js";

const execute = promisify(execFile);

/**
 * `recursive` opens one native handle per worktree root and outside Git directory and filters
 * events in process; `directories` opens one handle per watched directory. On macOS every
 * directory handle in a process shares one FSEventStream that libuv rebuilds, leaking memory per
 * watched path, whenever any handle opens or closes, so per-directory churn grows without bound.
 * Linux recursive watching is itself per directory, so inotify keeps the direct design.
 */
export type RepositoryChangeWatchMode = "recursive" | "directories";

const defaultWatchMode: RepositoryChangeWatchMode =
  process.platform === "darwin" || process.platform === "win32" ? "recursive" : "directories";

const within = (base: string, path: string) => path === base || path.startsWith(`${base}${sep}`);

/** Watches source directories and Git coordinates, ignoring caches and Git object storage. */
export async function watchRepositoryChanges(
  root: string,
  notify: () => void,
  failed: () => void = notify,
  options: { recoveryIntervalMs?: number; watchMode?: RepositoryChangeWatchMode } = {},
): Promise<() => void> {
  const recoveryInterval = options.recoveryIntervalMs ?? 60_000;
  const watchMode = options.watchMode ?? defaultWatchMode;
  if (
    !Number.isSafeInteger(recoveryInterval) ||
    recoveryInterval < 100 ||
    recoveryInterval > 60_000
  )
    throw new Error("Repository watcher recovery interval is invalid.");
  const watchers = new Map<string, FSWatcher>();
  let stopped = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing: Promise<void> | undefined;
  let recoveryTimer: ReturnType<typeof setInterval> | undefined;
  const git = async (args: string[]) =>
    (await execute("git", ["-C", root, ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout;
  const gitDirectory = resolve(root, (await git(["rev-parse", "--git-dir"])).trim());
  const commonDirectory = resolve(root, (await git(["rev-parse", "--git-common-dir"])).trim());
  const state = resolve(root, ".lervo/state");
  const gitRoots = new Set([gitDirectory, commonDirectory]);
  let scope: RepositoryChangeScope = { directories: new Set(), state, gitRoots };

  const close = () => {
    stopped = true;
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
    if (recoveryTimer !== undefined) clearInterval(recoveryTimer);
    for (const watcher of watchers.values()) watcher.close();
    watchers.clear();
  };
  const scheduleRefresh = () => {
    if (stopped || refreshTimer !== undefined) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = undefined;
      if (refreshing !== undefined) {
        scheduleRefresh();
        return;
      }
      refreshing = refresh()
        .catch(() => {
          close();
          failed();
        })
        .finally(() => {
          refreshing = undefined;
        });
    }, 250);
  };
  const open = (
    path: string,
    recursive: boolean,
    listener: (event: string, name?: string) => void,
  ) => {
    try {
      const watcher = watch(path, { persistent: false, recursive }, (event, filename) =>
        listener(event, filename?.toString()),
      );
      watcher.on("error", () => {
        close();
        failed();
      });
      watchers.set(path, watcher);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
  const openRecursive = () => {
    const bases: string[] = [];
    for (const base of [root, commonDirectory, gitDirectory])
      if (!bases.some((watched) => within(watched, base))) bases.push(base);
    for (const base of bases)
      open(base, true, (event, name) => {
        const decision = classifyRepositoryChange(event, base, name, scope);
        if (!decision.notify) return;
        notify();
        if (decision.refresh) scheduleRefresh();
      });
  };
  const openDirectory = (path: string) =>
    open(path, false, (event, name) => {
      const decision = classifyRepositoryChange(event, path, name, scope);
      if (!decision.notify) return;
      if (event === "rename" && name !== undefined) {
        const changedDirectory = name === basename(path) ? path : resolve(path, name);
        watchers.get(changedDirectory)?.close();
        watchers.delete(changedDirectory);
      }
      notify();
      if (decision.refresh) scheduleRefresh();
    });
  const refresh = async () => {
    const directories = await listRepositoryChangeDirectories({
      root,
      state,
      gitRoots,
      commonDirectory,
      git,
    });
    if (stopped) return;
    scope = { directories, state, gitRoots };
    if (watchMode === "recursive") return;
    for (const [path, watcher] of watchers) {
      if (!directories.has(path)) {
        watcher.close();
        watchers.delete(path);
      }
    }
    for (const path of directories) if (!watchers.has(path)) openDirectory(path);
  };
  try {
    await refresh();
    if (watchMode === "recursive") openRecursive();
    const observe = () => observeRepositoryChangeHint({ root, gitDirectory, commonDirectory, git });
    let observation = await observe();
    let observing = false;
    recoveryTimer = setInterval(() => {
      if (stopped || observing) return;
      observing = true;
      void observe()
        .then((next) => {
          if (stopped || next === observation) return;
          observation = next;
          notify();
          scheduleRefresh();
        })
        .catch(() => {
          if (!stopped) {
            close();
            failed();
          }
        })
        .finally(() => {
          observing = false;
        });
    }, recoveryInterval);
    recoveryTimer.unref();
  } catch (error) {
    close();
    throw error;
  }
  return close;
}
