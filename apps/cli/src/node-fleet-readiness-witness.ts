import type { NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";

import { NodeFleetApplyError, type NodeFleetApplyPorts } from "./node-fleet-apply-contract.js";
import { readNodeFleetHealthSnapshot } from "./node-fleet-health.js";
import {
  nodeReadinessComponentHealth,
  nodeReadinessComponentText,
  type NodeReadinessBlocker,
  type NodeReadinessComponent,
} from "./node-fleet-readiness-policy.js";

/** The replacement must prove these itself; a predecessor never vouches for them (ADR-0475). */
const deliveryComponents = new Set(["sync", "workstreamReplication"]);
const readyIntervalMs = 500;
/** Observations without progress before the witness gives up: 60 seconds. */
const idleObservationLimit = 120;
/** Observations however long the restored predecessor keeps progressing: 600 seconds. */
const maximumObservationLimit = 1_200;
const settledObservations = 3;

/**
 * ADR-0475: the blockers of a failed replacement whose baseline gave no evidence. The predecessor
 * had never evaluated the component (`pending`) or left no usable snapshot, while the replacement
 * settled it. Such a blocker is not yet a regression: it is one only if the predecessor, once
 * restored, settles differently. Null when the failure is anything else, including a delivery
 * component, a component the replacement never settled, or a recovery that did not restore.
 */
export function blockersWithoutBaselineEvidence(error: unknown): NodeReadinessBlocker[] | null {
  if (!(error instanceof NodeFleetApplyError)) return null;
  const { readiness, recovery } = error.details;
  if (error.code !== "node_fleet_readiness_timeout" || recovery !== "restored") return null;
  const blockers = readiness?.blockers ?? [];
  if (
    blockers.length === 0 ||
    blockers.some(
      (blocker) =>
        deliveryComponents.has(blocker.component) ||
        blocker.observed === "pending" ||
        (blocker.baseline !== null && blocker.baseline !== "pending"),
    )
  )
    return null;
  return blockers;
}

/**
 * Observes the restored predecessor until each of `components` leaves `pending` in three
 * consecutive fresh, settled (`ready` or `degraded`) snapshots of one process that is not the
 * failed replacement, and returns
 * their states. Like readiness, the window lasts 60 seconds past the latest progress (a component
 * settling or an advancing `starting` heartbeat), bounded at 600 seconds; null when it ends first.
 */
export async function witnessRestoredPredecessor(request: {
  path: string;
  notBefore: Date;
  replacementProcessId: number | null;
  components: readonly NodeReadinessComponent[];
  ports: Pick<NodeFleetApplyPorts, "readHealth" | "wait">;
}): Promise<Partial<Record<NodeReadinessComponent, string>> | null> {
  const read = request.ports.readHealth ?? readNodeFleetHealthSnapshot;
  const wait =
    request.ports.wait ??
    ((durationMs: number) => new Promise<void>((done) => setTimeout(done, durationMs)));
  let deadline = idleObservationLimit;
  let settledMark = -1;
  let heartbeat: { identity: string; updatedAt: number } | null = null;
  type Streak = { identity: string; states: string; count: number };
  let streak = null as Streak | null;
  for (let attempt = 0; attempt < Math.min(deadline, maximumObservationLimit); attempt += 1) {
    let snapshot: NodeRuntimeHealthSnapshot | null = null;
    try {
      snapshot = await read(request.path);
    } catch {
      streak = null;
    }
    if (
      snapshot !== null &&
      snapshot.processId !== request.replacementProcessId &&
      Date.parse(snapshot.updatedAt) >= request.notBefore.getTime()
    ) {
      const identity = `${snapshot.processId}\0${snapshot.startedAt}`;
      const states = request.components.map((component) =>
        nodeReadinessComponentText(nodeReadinessComponentHealth(snapshot!, component)),
      );
      const settled = states.filter((state) => state !== "pending").length;
      const updatedAt = Date.parse(snapshot.updatedAt);
      const advanced =
        snapshot.status === "starting" &&
        heartbeat?.identity === identity &&
        updatedAt > heartbeat.updatedAt;
      heartbeat = { identity, updatedAt };
      if (settled > settledMark || advanced) {
        settledMark = Math.max(settledMark, settled);
        deadline = attempt + idleObservationLimit;
      }
      // Only a settled Node's states count: a starting one may still change any of them.
      if (
        settled === states.length &&
        (snapshot.status === "ready" || snapshot.status === "degraded")
      ) {
        const key = states.join("\n");
        streak =
          streak?.identity === identity && streak.states === key
            ? { ...streak, count: streak.count + 1 }
            : { identity, states: key, count: 1 };
        if (streak.count === settledObservations)
          return Object.fromEntries(
            request.components.map((component, index) => [component, states[index]!]),
          );
      } else streak = null;
    }
    await wait(readyIntervalMs);
  }
  return null;
}
