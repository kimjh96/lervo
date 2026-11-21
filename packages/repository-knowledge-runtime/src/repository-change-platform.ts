/**
 * `recursive` opens one native handle per worktree root and per Git directory or runtime state
 * outside it, and filters events in process; `directories` opens one handle per watched
 * directory. On macOS every directory handle in a process shares one FSEventStream that libuv
 * rebuilds, leaking memory per watched path, whenever any handle opens or closes, so per-directory
 * churn grows without bound. Linux recursive watching is itself per directory, so inotify keeps
 * the direct design.
 */
export type RepositoryChangeWatchMode = "recursive" | "directories";

const caseInsensitivePlatforms = new Set<NodeJS.Platform>(["darwin", "win32"]);

export const defaultRepositoryChangeWatchMode = (
  platform: NodeJS.Platform,
): RepositoryChangeWatchMode =>
  caseInsensitivePlatforms.has(platform) ? "recursive" : "directories";

/** Default macOS and Windows volumes ignore case; Linux paths stay exact. */
export const foldsRepositoryPathCase = (platform: NodeJS.Platform) =>
  caseInsensitivePlatforms.has(platform);
