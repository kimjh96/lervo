import { execFile } from "node:child_process";
import type { NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";

import {
  failNodeFleetApply,
  type NodeFleetApplyPorts,
  type NodeFleetApplyReceipt,
} from "./node-fleet-apply-contract.js";
import { readNodeFleetHealthSnapshot } from "./node-fleet-health.js";
import {
  describeNodeReadinessBlockers,
  evaluateNodeReadiness,
  nodeReadinessBaselineFrom,
  nodeReadinessComponentHealth,
  nodeReadinessComponentText,
  type NodeReadinessBaseline,
  type NodeReadinessEvaluation,
} from "./node-fleet-readiness-policy.js";

type Readiness = NodeFleetApplyReceipt["readiness"];

const readyObservations = 3;
const readyIntervalMs = 500;
/** Observations without startup progress before readiness fails: 60 seconds. */
const idleObservationLimit = 120;
/** Observations however long startup keeps progressing: 600 seconds. */
const maximumObservationLimit = 1_200;
/** A `starting` or `stopping` snapshot older than this no longer describes a running process. */
const baselineFreshnessMs = 2 * 60_000;

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

/** How much earlier than its snapshot's `startedAt` the Node process may have started. */
const startupAllowanceMs = 10 * 60_000;

/**
 * Whether the process that wrote a snapshot still runs: its pid is alive and that process started
 * no later than the snapshot's `startedAt`. A reused pid belongs to a process that started after
 * the writer ended, so it never counts; an unprovable start time does not count either.
 */
async function snapshotProcessRunning(processId: number, startedAt: string): Promise<boolean> {
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

function execFileText(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(command, args, { timeout: 5_000 }, (error, stdout) =>
      error === null ? resolvePromise(stdout) : reject(error),
    );
  });
}

/**
 * Reads the predecessor's component states before a service operation replaces it. Failure to
 * read yields no baseline, which carries nothing over; it never blocks the operation. A settled
 * Node (`ready` or `degraded`) writes its snapshot only when a component changes, so its age says
 * nothing: it describes the predecessor as long as the process that wrote it still runs. Only a `starting` or
 * `stopping` snapshot, which a live process keeps refreshing, goes stale by age.
 */
export async function captureNodeFleetReadinessBaseline(
  path: string,
  ports: Pick<NodeFleetApplyPorts, "readHealth" | "processRunning">,
  now: Date,
): Promise<NodeReadinessBaseline> {
  const read = ports.readHealth ?? readNodeFleetHealthSnapshot;
  let snapshot: NodeRuntimeHealthSnapshot;
  try {
    snapshot = await read(path);
  } catch {
    return { status: "unavailable" };
  }
  const settled = snapshot.status === "ready" || snapshot.status === "degraded";
  const current = settled
    ? await (ports.processRunning ?? snapshotProcessRunning)(snapshot.processId, snapshot.startedAt)
    : now.getTime() - Date.parse(snapshot.updatedAt) <= baselineFreshnessMs;
  return current ? nodeReadinessBaselineFrom(snapshot) : { status: "stale" };
}

function readinessReceipt(
  snapshot: NodeRuntimeHealthSnapshot,
  evaluation: NodeReadinessEvaluation,
  baseline: NodeReadinessBaseline,
): Readiness {
  const text = (component: Parameters<typeof nodeReadinessComponentHealth>[1]): string =>
    nodeReadinessComponentText(nodeReadinessComponentHealth(snapshot, component));
  return {
    status: evaluation.offline ? "offline_ready" : "ready",
    observations: readyObservations,
    processId: snapshot.processId,
    startedAt: snapshot.startedAt,
    sync: text("sync") as Readiness["sync"],
    workstreamReplication: text("workstreamReplication") as Readiness["workstreamReplication"],
    workspaceCoordination: text("workspaceCoordination") as Readiness["workspaceCoordination"],
    remoteControl: text("remoteControl") as Readiness["remoteControl"],
    conversation: text("conversation"),
    supervision: text("supervision"),
    baseline: baseline.status,
    carriedConditions: evaluation.carried,
  };
}

/**
 * ADR-0480: liveness of the replacement, the first process seen `starting` that is not the
 * predecessor. Its advancing `updatedAt` heartbeat is startup progress. A predecessor still
 * writing `starting` before it stops never counts: it is known by the identity the baseline
 * recorded, which no clock step can change. Without an observed baseline, a process that started
 * before the service operation is taken for the predecessor. Another replacement later reporting
 * `starting` means the replacement restarted, so liveness stops counting for the rest of the
 * observation.
 */
class StartingLiveness {
  private identity: string | null = null;
  private updatedAt = 0;
  private replaced = false;

  constructor(
    private readonly predecessor: string | null,
    private readonly notBefore: number,
  ) {}

  advanced(snapshot: NodeRuntimeHealthSnapshot, identity: string, updatedAt: number): boolean {
    if (snapshot.status !== "starting" || this.replaced) return false;
    if (
      this.predecessor !== null
        ? identity === this.predecessor
        : !(Date.parse(snapshot.startedAt) >= this.notBefore)
    )
      return false;
    if (this.identity === null) {
      this.identity = identity;
      this.updatedAt = updatedAt;
      return false;
    }
    if (this.identity !== identity) {
      this.replaced = true;
      return false;
    }
    if (updatedAt <= this.updatedAt) return false;
    this.updatedAt = updatedAt;
    return true;
  }
}

/**
 * Requires three consecutive fresh, monotonic observations from one process in which no
 * component regressed from its baseline. The window lasts 60 seconds past the latest startup
 * progress (a first fresh snapshot, more accepted components, or an advancing `starting`
 * heartbeat from the same process), bounded at 600 seconds.
 */
export async function observeNodeFleetReadiness(request: {
  path: string;
  notBefore: Date;
  ports: NodeFleetApplyPorts;
  allowHubUnavailable: boolean;
  baseline?: NodeReadinessBaseline;
}): Promise<Readiness> {
  const read = request.ports.readHealth ?? readNodeFleetHealthSnapshot;
  const wait =
    request.ports.wait ??
    ((durationMs: number) => new Promise<void>((done) => setTimeout(done, durationMs)));
  const baseline = request.baseline ?? { status: "not_applicable" };
  let consecutive = 0;
  let identity: string | null = null;
  let previousUpdatedAt = 0;
  let last: { snapshot: NodeRuntimeHealthSnapshot; evaluation: NodeReadinessEvaluation } | null =
    null;
  let progressMark = -1;
  const liveness = new StartingLiveness(
    baseline.status === "observed" ? `${baseline.processId}\0${baseline.startedAt}` : null,
    request.notBefore.getTime(),
  );
  let deadline = idleObservationLimit;
  let attempt = 0;
  for (; attempt < Math.min(deadline, maximumObservationLimit); attempt += 1) {
    try {
      const current = await read(request.path);
      const currentIdentity = `${current.processId}\0${current.startedAt}`;
      const updatedAt = Date.parse(current.updatedAt);
      const evaluation = evaluateNodeReadiness(current, baseline, request.allowHubUnavailable);
      const fresh = updatedAt >= request.notBefore.getTime();
      if (fresh) {
        last = { snapshot: current, evaluation };
        const live = liveness.advanced(current, currentIdentity, updatedAt);
        if (evaluation.acceptedCount > progressMark || live) {
          progressMark = Math.max(progressMark, evaluation.acceptedCount);
          deadline = attempt + idleObservationLimit;
        }
      }
      if (
        fresh &&
        evaluation.complete &&
        (identity === null || identity === currentIdentity) &&
        updatedAt >= previousUpdatedAt
      ) {
        identity = currentIdentity;
        previousUpdatedAt = updatedAt;
        consecutive += 1;
        if (consecutive === readyObservations)
          return readinessReceipt(current, evaluation, baseline);
      } else {
        consecutive = 0;
        identity = null;
        previousUpdatedAt = 0;
      }
    } catch {
      consecutive = 0;
      identity = null;
      previousUpdatedAt = 0;
    }
    await wait(readyIntervalMs);
  }
  const blockers = last?.evaluation.blockers ?? [];
  failNodeFleetApply(
    "node_fleet_readiness_timeout",
    last === null
      ? `The Node runtime did not publish a fresh readiness snapshot within ${
          (attempt * readyIntervalMs) / 1_000
        } seconds.`
      : blockers.length > 0
        ? `The Node runtime did not become ready: ${describeNodeReadinessBlockers(blockers)}.`
        : `The Node runtime did not remain ready for three consecutive observations (last status ${last.snapshot.status}).`,
    undefined,
    {
      readiness: {
        baseline: baseline.status,
        blockers,
        lastStatus: last?.snapshot.status ?? null,
        lastProcessId: last?.snapshot.processId ?? null,
        observations: attempt,
      },
    },
  );
}
