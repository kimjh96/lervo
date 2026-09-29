import { execFile } from "node:child_process";
import { watch, type FSWatcher } from "node:fs";
import { basename, dirname, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { observeRepositoryChangeHint } from "./repository-change-observation.js";

const execute = promisify(execFile);
const maximumDirectories = 4_096;

/** Watches source directories and Git coordinates without recursively watching ignored caches. */
export async function watchRepositoryChanges(
  root: string,
  notify: () => void,
  failed: () => void = notify,
  options: { recoveryIntervalMs?: number } = {},
): Promise<() => void> {
  const recoveryInterval = options.recoveryIntervalMs ?? 60_000;
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
  const refresh = async () => {
    const paths = (await git(["ls-files", "--cached", "--others", "--exclude-standard", "-z"]))
      .split("\0")
      .filter(Boolean);
    const directories = new Set([
      root,
      state,
      ...gitRoots,
      resolve(commonDirectory, "refs"),
      resolve(commonDirectory, "refs/heads"),
    ]);
    for (const path of paths) {
      let parent = dirname(resolve(root, path));
      while (parent !== root && parent.startsWith(`${root}${sep}`)) {
        directories.add(parent);
        parent = dirname(parent);
      }
    }
    for (const reference of (await git(["for-each-ref", "--format=%(refname)", "refs/heads"]))
      .trim()
      .split("\n")
      .filter(Boolean)) {
      let parent = dirname(resolve(commonDirectory, reference));
      while (parent.startsWith(`${commonDirectory}${sep}refs${sep}heads`)) {
        directories.add(parent);
        parent = dirname(parent);
      }
    }
    if (directories.size > maximumDirectories)
      throw new Error("Repository watcher directory limit exceeded.");
    if (stopped) return;
    for (const [path, watcher] of watchers) {
      if (!directories.has(path)) {
        watcher.close();
        watchers.delete(path);
      }
    }
    for (const path of directories) {
      if (watchers.has(path)) continue;
      try {
        const watcher = watch(path, { persistent: false }, (event, filename) => {
          const name = filename?.toString();
          if (path === state && name !== undefined && name !== "repository-replica-request.json")
            return;
          if (
            gitRoots.has(path) &&
            name !== undefined &&
            !["HEAD", "index", "packed-refs", "config"].includes(name)
          )
            return;
          if (event === "rename" && name !== undefined) {
            const changedDirectory = name === basename(path) ? path : resolve(path, name);
            watchers.get(changedDirectory)?.close();
            watchers.delete(changedDirectory);
          }
          notify();
          if (event === "rename" || name === ".gitignore" || name === "exclude") scheduleRefresh();
        });
        watcher.on("error", () => {
          close();
          failed();
        });
        watchers.set(path, watcher);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  };
  try {
    await refresh();
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
