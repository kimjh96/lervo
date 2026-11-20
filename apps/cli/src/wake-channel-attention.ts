import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { readRepositoryWatchIssues } from "@lervo/node-runtime";
import { resolveProjectPaths } from "@lervo/project";
import { inspectEventStoreChannel } from "@lervo/project-storage";
import type { EventStore } from "@lervo/storage-contract";

import type { TerminalLifecycleInspection } from "./terminal-hook-contract.js";

type Issue = TerminalLifecycleInspection["issues"][number];

const COMMANDS: Record<string, string> = {
  event_channel_refused:
    "make the run directory a real directory owned by the database owner with mode 700, then restart the Lervo services",
  event_channel_unsupported:
    "move the repository to a filesystem that supports named pipes, then restart the Lervo services",
  event_channel_writer_without_ping:
    "run lervo upgrade and stop Lervo processes started before it, so every writer pings",
  event_channel_detector_unavailable:
    "raise the file watch limit (Linux: sysctl fs.inotify.max_user_watches=524288) and restart the Lervo services",
  event_channel_subscriber_unreachable:
    "run Lervo commands for this repository as the user that owns .lervo/data/events.sqlite",
  event_channel_unavailable: "restart the Lervo services for this repository",
  event_channel_mkfifo_missing: "install coreutils so mkfifo is in /usr/bin or /bin",
  event_channel_subscriber_stalled:
    "check that the Lervo services for this repository are running and not stopped",
  event_channel_foreign_host:
    "run the Lervo services for this checkout on one host; another kernel cannot be woken",
  event_channel_identity_unknown:
    "make /etc/machine-id (Linux) readable, or restart the Lervo services so they record this host",
};

async function nodeServiceSettling(root: string): Promise<boolean> {
  try {
    const health = JSON.parse(
      await readFile(join(root, ".lervo/state/node-runtime-health.json"), "utf8"),
    ) as { status?: unknown };
    return health.status === "starting" || health.status === "stopping";
  } catch {
    return false;
  }
}

/**
 * ADR-0602: what keeps changes from waking this repository's services, as attention issues. The
 * event channel and the repository watch report their own problems; nothing here is inferred.
 */
export async function readWakeChannelAttention(
  root: string,
  events?: Pick<EventStore, "latest"> & { latestSeq?(): number | null },
): Promise<Issue[]> {
  const issues: Issue[] = [];
  // ADR-0602: the store's head lets inspection tell a stalled subscriber. While the Node service
  // starts (it verifies history first) or stops, a subscriber that has not observed is expected.
  const history =
    events === undefined || (await nodeServiceSettling(root))
      ? undefined
      : { headSeq: () => events.latestSeq?.() ?? events.latest()?.seq ?? null };
  try {
    for (const issue of inspectEventStoreChannel(
      resolveProjectPaths(root).eventDatabase,
      history === undefined ? {} : { history },
    ))
      issues.push({
        code: issue.code,
        command: COMMANDS[issue.code] ?? "run lervo doctor",
        detail: issue.detail,
      });
  } catch {
    issues.push({ code: "event_channel_refused", command: COMMANDS.event_channel_refused! });
  }
  for (const watch of await readRepositoryWatchIssues(root))
    issues.push({ code: watch.code, command: watch.command, detail: watch.detail });
  return issues;
}
