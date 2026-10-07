import { createHash } from "node:crypto";
import { canonicalJson } from "@lervo/event-contract";
import { validateSchema, type WorkstreamReplicationReadResponse } from "@lervo/schemas";
import type { LocalWorkstreamRevision } from "./workstream-replication.js";

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/** An explicit choice produces a successor; neither predecessor history is rewritten. */
export function planWorkstreamReconciliation(input: {
  projectId: string;
  local: LocalWorkstreamRevision;
  remote: WorkstreamReplicationReadResponse;
  keep: "local" | "hub";
  now: string;
}) {
  const { local, remote, keep } = input;
  const hashSnapshot = (value: unknown) =>
    `sha256:${createHash("sha256")
      .update(`${canonicalJson(value)}\n`)
      .digest("hex")}`;
  if (
    !validateSchema("workstreamSnapshot", local.snapshot).valid ||
    hashSnapshot(local.snapshot) !== local.snapshotContentHash ||
    remote.projectId !== input.projectId
  )
    throw new Error("Reconciliation requires verified local and Hub coordinates.");
  if (
    remote.snapshot !== null &&
    (hashSnapshot(remote.snapshot) !== remote.heads[0]?.snapshotContentHash ||
      remote.snapshot.workstreamId !== remote.heads[0]?.workstreamId ||
      remote.snapshot.revision !== remote.heads[0]?.revision)
  )
    throw new Error("The Hub snapshot differs from its disclosed head.");
  if (remote.status === "not_found") throw new Error("The Hub has no workstream to reconcile.");
  const peerHeads = remote.heads.filter(
    (head) => head.snapshotContentHash !== local.snapshotContentHash,
  );
  if (peerHeads.length !== 1 || remote.heads.length > 2)
    throw new Error("Reconciliation requires exactly one local and one Hub head.");
  if (keep === "hub" && remote.snapshot === null)
    throw new Error("Keeping the Hub requires its exact unique snapshot.");
  const peer = peerHeads[0]!;
  const parents = [
    { workstreamId: local.snapshot.workstreamId, snapshotContentHash: local.snapshotContentHash },
    { workstreamId: peer.workstreamId, snapshotContentHash: peer.snapshotContentHash },
  ].sort((left, right) => left.snapshotContentHash.localeCompare(right.snapshotContentHash));
  const selected = keep === "local" ? local.snapshot : remote.snapshot!;
  const selectedHash = keep === "local" ? local.snapshotContentHash : peer.snapshotContentHash;
  const coordinate = { projectId: input.projectId, parents, keep };
  const snapshot = {
    ...structuredClone(selected),
    workstreamId: `wks_${digest(coordinate).slice(0, 24)}`,
    revision: 1,
    origin: {
      kind: "successor" as const,
      sourceArtifactId: null,
      sourceContentHash: null,
      sourcePathDigest: null,
      predecessorWorkstreamId: selected.workstreamId,
      predecessorSnapshotContentHash: selectedHash,
      reconciliationPredecessors: parents,
    },
    updatedAt: input.now,
  };
  if (!validateSchema("workstreamSnapshot", snapshot).valid)
    throw new Error("The reconciliation successor does not satisfy the workstream contract.");
  const content = `${canonicalJson(snapshot)}\n`;
  return {
    planId: `wrec_${digest(coordinate).slice(0, 24)}`,
    keep,
    parents,
    revision: {
      snapshot,
      snapshotContentHash: `sha256:${createHash("sha256").update(content).digest("hex")}`,
      previousSnapshotContentHash: selectedHash,
    } satisfies LocalWorkstreamRevision,
  };
}
