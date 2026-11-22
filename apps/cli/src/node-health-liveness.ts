import { execFile } from "node:child_process";

import type { NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";

/** Whether the process that wrote a snapshot, named by its pid and `startedAt`, still runs. */
export type NodeHealthProcessRunning = (processId: number, startedAt: string) => Promise<boolean>;

/** A `starting` or `stopping` snapshot older than this no longer describes a running process. */
export const NODE_HEALTH_HEARTBEAT_FRESHNESS_MS = 2 * 60_000;

/** How much earlier than its snapshot's `startedAt` the Node process may have started. */
const startupAllowanceMs = 10 * 60_000;

/** `ps` elapsed time, `[[dd-]hh:]mm:ss`, in milliseconds; null when it is not one. */
function elapsedMs(text: string): number | null {
  const match = /^(?:(?:(\d+)-)?(\d+):)?(\d+):(\d+)$/u.exec(text.trim());
  if (match === null) return null;
  const [, days, hours, minutes, seconds] = match;
  return (
    (((Number(days ?? 0) * 24 + Number(hours ?? 0)) * 60 + Number(minutes)) * 60 +
      Number(seconds)) *
    1_000
  );
}

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { timeout: 5_000 }, (error, stdout) =>
      error === null ? resolvePromise(stdout) : reject(error),
    );
  });
}

/**
 * Whether the process that wrote a snapshot still runs: its pid is alive and that process started
 * no later than the snapshot's `startedAt`. A reused pid belongs to a process that started after
 * the writer ended, so it never counts; an unprovable start time does not count either.
 */
export async function snapshotProcessRunning(
  processId: number,
  startedAt: string,
): Promise<boolean> {
  try {
    process.kill(processId, 0);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EPERM") return false;
  }
  const output = await execFileText("ps", ["-o", "etime=", "-p", String(processId)]).catch(
    () => null,
  );
  const elapsed = output === null ? null : elapsedMs(output);
  if (elapsed === null) return false;
  const started = Date.now() - elapsed;
  const written = Date.parse(startedAt);
  // `ps` reports whole seconds, so the start is known to within about two.
  return started <= written + 2_000 && started >= written - startupAllowanceMs;
}

/**
 * Whether a Node health snapshot still describes a running process. A settled Node (`ready` or
 * `degraded`) writes its snapshot only when a component changes, and since ADR-0602 an idle Node
 * runs no cycle at all, so the snapshot's age says nothing: it is current while the process that
 * wrote it runs. Only a `starting` or `stopping` snapshot, which a live process keeps refreshing,
 * goes stale by age. Every reader that judges a Node by its snapshot uses this one rule.
 */
export async function nodeHealthSnapshotCurrent(
  snapshot: Pick<NodeRuntimeHealthSnapshot, "status" | "processId" | "startedAt" | "updatedAt">,
  now: Date,
  processRunning: NodeHealthProcessRunning = snapshotProcessRunning,
): Promise<boolean> {
  if (snapshot.status === "ready" || snapshot.status === "degraded")
    return processRunning(snapshot.processId, snapshot.startedAt);
  return now.getTime() - Date.parse(snapshot.updatedAt) <= NODE_HEALTH_HEARTBEAT_FRESHNESS_MS;
}
