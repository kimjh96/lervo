import { execFileSync } from "node:child_process";

import type { EventStoreChannelIssue } from "./change-channel-state.js";

/** Absolute paths first, so a missing PATH entry is told apart from a missing tool. */
export const MKFIFO = ["/usr/bin/mkfifo", "/bin/mkfifo", "mkfifo"] as const;

export function createFifo(path: string, tools: readonly string[]): EventStoreChannelIssue | null {
  let missing = 0;
  for (const tool of tools) {
    try {
      // Node has no mkfifo; the system tool runs once per subscription, never per commit.
      execFileSync(tool, ["-m", "600", path], { stdio: "ignore" });
      return null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        missing += 1;
        continue;
      }
      return {
        code: "event_channel_unsupported",
        detail: `mkfifo failed in ${path}: ${(error as Error).message.split("\n")[0]}. Move the repository to a filesystem that supports named pipes.`,
      };
    }
  }
  return missing === tools.length
    ? {
        code: "event_channel_mkfifo_missing",
        detail: "No mkfifo tool was found in /usr/bin, /bin or PATH. Install coreutils.",
      }
    : null;
}
