import { createHash } from "node:crypto";
import { canonicalJson } from "@lervo/event-contract";
import {
  validateSchema,
  workstreamReconciliationPredecessors,
  type WorkstreamSnapshot,
} from "@lervo/schemas";
import type { LocalWorkstreamRevision } from "./workstream-replication.js";

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function snapshotContentHash(snapshot: WorkstreamSnapshot): string {
  return `sha256:${createHash("sha256")
    .update(`${canonicalJson(snapshot)}\n`)
    .digest("hex")}`;
}

/** A revision is valid when it satisfies the snapshot contract and hashes to its stated identity. */
function assertValidRevision(revision: LocalWorkstreamRevision, side: string): void {
  if (
    !validateSchema("workstreamSnapshot", revision.snapshot).valid ||
    snapshotContentHash(revision.snapshot) !== revision.snapshotContentHash
  )
    throw new Error(`The ${side} workstream head is not a valid snapshot.`);
}

/**
 * ADR-0561: the newest valid head wins by `updatedAt`, then revision, then content hash. Every
 * host computes the same order from the same two heads, so concurrent reconcilers agree.
 */
export function newestWorkstreamHead(
  left: LocalWorkstreamRevision,
  right: LocalWorkstreamRevision,
): LocalWorkstreamRevision {
  const time = Date.parse(left.snapshot.updatedAt) - Date.parse(right.snapshot.updatedAt);
  if (time !== 0) return time > 0 ? left : right;
  if (left.snapshot.revision !== right.snapshot.revision)
    return left.snapshot.revision > right.snapshot.revision ? left : right;
  return left.snapshotContentHash > right.snapshotContentHash ? left : right;
}

export interface WorkstreamReconciliationPlan {
  planId: string;
  kept: "local" | "hub";
  /** Both exact parents, sorted by content hash; the Hub retains each as immutable history. */
  parents: { workstreamId: string; snapshotContentHash: string }[];
  /** The head that was not kept; `lervo workstream reconcile --restore` brings its body back. */
  preserved: { workstreamId: string; snapshotContentHash: string };
  revision: LocalWorkstreamRevision;
}

/**
 * Keeps the newest valid of two divergent heads as a successor that names both; neither
 * predecessor history is rewritten. The successor's bytes depend only on the two heads, so two
 * hosts reconciling the same fork publish the identical revision.
 */
export function planWorkstreamReconciliation(input: {
  projectId: string;
  local: LocalWorkstreamRevision;
  peer: LocalWorkstreamRevision;
}): WorkstreamReconciliationPlan {
  assertValidRevision(input.local, "local");
  assertValidRevision(input.peer, "Hub");
  if (input.local.snapshotContentHash === input.peer.snapshotContentHash)
    throw new Error("Reconciliation requires two distinct heads.");
  const kept = newestWorkstreamHead(input.local, input.peer);
  const other = kept === input.local ? input.peer : input.local;
  const parents = [input.local, input.peer]
    .map((head) => ({
      workstreamId: head.snapshot.workstreamId,
      snapshotContentHash: head.snapshotContentHash,
    }))
    .sort((left, right) => left.snapshotContentHash.localeCompare(right.snapshotContentHash));
  const coordinate = {
    projectId: input.projectId,
    parents,
    selected: kept.snapshotContentHash,
  };
  const snapshot: WorkstreamSnapshot = {
    ...structuredClone(kept.snapshot),
    workstreamId: `wks_${digest(coordinate).slice(0, 24)}`,
    revision: 1,
    origin: {
      kind: "successor",
      sourceArtifactId: null,
      sourceContentHash: null,
      sourcePathDigest: null,
      predecessorWorkstreamId: kept.snapshot.workstreamId,
      predecessorSnapshotContentHash: kept.snapshotContentHash,
      reconciliationPredecessors: parents,
    },
  };
  if (!validateSchema("workstreamSnapshot", snapshot).valid)
    throw new Error("The reconciliation successor does not satisfy the workstream contract.");
  return {
    planId: `wrec_${digest(coordinate).slice(0, 24)}`,
    kept: kept === input.local ? "local" : "hub",
    parents,
    preserved: {
      workstreamId: other.snapshot.workstreamId,
      snapshotContentHash: other.snapshotContentHash,
    },
    revision: {
      snapshot,
      snapshotContentHash: snapshotContentHash(snapshot),
      previousSnapshotContentHash: kept.snapshotContentHash,
    },
  };
}

/**
 * The undo of a reconciliation: the next revision of the current successor carries the preserved
 * parent's body. Only a parent the current workstream names can be restored.
 */
export function planWorkstreamHeadRestore(input: {
  current: LocalWorkstreamRevision;
  preserved: LocalWorkstreamRevision;
  now: string;
}): LocalWorkstreamRevision {
  assertValidRevision(input.current, "current");
  assertValidRevision(input.preserved, "preserved");
  const parents = workstreamReconciliationPredecessors(input.current.snapshot) ?? [];
  const reconciliationParent = parents.some(
    (parent) =>
      parent.workstreamId === input.preserved.snapshot.workstreamId &&
      parent.snapshotContentHash === input.preserved.snapshotContentHash,
  );
  // An earlier revision of the same successor undoes a previous restore.
  const earlierRevision =
    parents.length > 0 &&
    input.preserved.snapshot.workstreamId === input.current.snapshot.workstreamId &&
    input.preserved.snapshot.revision < input.current.snapshot.revision;
  if (!reconciliationParent && !earlierRevision)
    throw new Error(
      "Only a reconciliation parent or an earlier revision of the current successor can be restored.",
    );
  const snapshot: WorkstreamSnapshot = {
    ...structuredClone(input.preserved.snapshot),
    workstreamId: input.current.snapshot.workstreamId,
    revision: input.current.snapshot.revision + 1,
    origin: structuredClone(input.current.snapshot.origin),
    updatedAt: input.now,
  };
  if (!validateSchema("workstreamSnapshot", snapshot).valid)
    throw new Error("The restored workstream does not satisfy the workstream contract.");
  return {
    snapshot,
    snapshotContentHash: snapshotContentHash(snapshot),
    previousSnapshotContentHash: input.current.snapshotContentHash,
  };
}
