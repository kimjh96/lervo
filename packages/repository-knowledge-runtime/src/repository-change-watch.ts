import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import {
  locateRepositoryEvent,
  needsRecursiveWatch,
  type RepositoryWatchBase,
} from "./repository-change-bases.js";
import {
  classifyRepositoryChange,
  createRepositoryChangeScope,
} from "./repository-change-classification.js";
import { listRepositoryChangeDirectories } from "./repository-change-directories.js";
import { repositoryWatchReporter } from "./repository-watch-state.js";
import {
  defaultRepositoryChangeWatchMode,
  foldsRepositoryPathCase,
  type RepositoryChangeWatchMode,
} from "./repository-change-platform.js";

const execute = promisify(execFile);

/**
 * Watches source directories and Git coordinates, ignoring caches and Git object storage.
 *
 * ADR-0602: notifications are level-triggered: a wake makes the caller read the repository state
 * itself, so any notification after the last change brings it up to date. There is no recovery
 * poll. A watch that cannot be armed or fails is recorded as `repository_watch_unavailable` and
 * reported through `failed`, so the caller re-reads at once and restarts the watch.
 */
export async function watchRepositoryChanges(
  root: string,
  notify: () => void,
  failed: () => void = notify,
  options: { watchMode?: RepositoryChangeWatchMode } = {},
): Promise<() => void> {
  const watchMode = options.watchMode ?? defaultRepositoryChangeWatchMode(process.platform);
  const foldCase = foldsRepositoryPathCase(process.platform);
  const watchers = new Map<string, FSWatcher>();
  const report = repositoryWatchReporter(root);
  let stopped = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshing: Promise<void> | undefined;
  const git = async (args: string[]) =>
    (await execute("git", ["-C", root, ...args], { maxBuffer: 4 * 1024 * 1024 })).stdout;
  const gitDirectory = resolve(root, (await git(["rev-parse", "--git-dir"])).trim());
  const commonDirectory = resolve(root, (await git(["rev-parse", "--git-common-dir"])).trim());
  const state = resolve(root, ".lervo/state");
  const gitRoots = new Set([gitDirectory, commonDirectory]);
  let scope = createRepositoryChangeScope({ directories: [], state, gitRoots, foldCase });
  // Logical bases with a known real path; events from any handle are classified in their frame.
  const bases = new Map<string, RepositoryWatchBase>();

  const close = () => {
    stopped = true;
    if (refreshTimer !== undefined) clearTimeout(refreshTimer);
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
    key: string,
    path: string,
    recursive: boolean,
    listener: (event: string, name?: string) => void,
  ) => {
    try {
      const watcher = watch(path, { persistent: false, recursive }, (event, filename) =>
        listener(event, filename?.toString()),
      );
      watcher.on("error", (error) => {
        // ADR-0602: a lost watch is visible until a new one is armed.
        void report.failed(error);
        close();
        failed();
      });
      watchers.set(key, watcher);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  };
  // Opens only bases without a handle: a missing base is retried on the next refresh, while an
  // open handle is never closed or reopened, which would rebuild the macOS FSEventStream.
  const openRecursive = async () => {
    for (const logical of [root, commonDirectory, gitDirectory, state]) {
      if (watchers.has(logical)) continue;
      let real: string;
      try {
        real = await realpath(logical);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (stopped) return;
      if (watchers.has(logical)) continue;
      const candidate = { logical, real };
      bases.set(logical, candidate);
      const watched = [...watchers.keys()].flatMap((key) => bases.get(key) ?? []);
      if (!needsRecursiveWatch(candidate, watched, foldCase)) continue;
      open(logical, real, true, (event, name) => {
        const location = locateRepositoryEvent(candidate, name, [...bases.values()], foldCase);
        const decision = classifyRepositoryChange(event, location.base, location.filename, scope);
        if (!decision.notify) return;
        notify();
        if (decision.refresh) scheduleRefresh();
      });
    }
  };
  const openDirectory = (path: string) =>
    open(path, path, false, (event, name) => {
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
    scope = createRepositoryChangeScope({ directories, state, gitRoots, foldCase });
    if (watchMode === "recursive") {
      await openRecursive();
      return;
    }
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
    await report.armed();
  } catch (error) {
    await report.failed(error);
    close();
    throw error;
  }
  return () => {
    close();
    void report.armed();
  };
}
