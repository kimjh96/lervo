import {
  validateSchema,
  type ProjectRegistrationRequest,
  type WorkstreamReplicationRevisionResponse,
} from "@lervo/schemas";

import { authenticatedResponseBody } from "./peer-response.js";
import type { AuthenticatedWorkstreamHubTransport } from "./transport.js";
import {
  planWorkstreamHeadRestore,
  planWorkstreamReconciliation,
} from "./workstream-reconciliation.js";
import {
  readHubWorkstream,
  WorkstreamReplicationCycleError,
  type LocalWorkstreamRevision,
  type WorkstreamReplicationLocalPort,
} from "./workstream-replication.js";

export interface WorkstreamDivergenceCycle {
  local: WorkstreamReplicationLocalPort;
  transport: AuthenticatedWorkstreamHubTransport;
  registration: ProjectRegistrationRequest;
  destinationId: string;
  expectedPeerIdentityHash: string;
}

/** The after-the-fact notice of a reconciliation (ADR-0561); it carries hashes, never bodies. */
export interface WorkstreamReconciliationNotice {
  effect: "workstream_reconciled" | "workstream_head_restored";
  targets: string[];
  reason: string;
  crossCheck: { reviewers: string[]; verdict: "agree" };
  undo: string;
}

export type WorkstreamDivergenceResult =
  | { status: "not_divergent" }
  /** More than two heads, or the local head is not among them: Lervo's own debt, never the owner's. */
  | { status: "held"; reason: "more_than_two_heads" | "local_head_unpublished"; headCount: number }
  | {
      status: "reconciled";
      planId: string;
      kept: "local" | "hub";
      parents: { workstreamId: string; snapshotContentHash: string }[];
      preserved: { workstreamId: string; snapshotContentHash: string };
      workstreamId: string;
      snapshotContentHash: string;
      notice: WorkstreamReconciliationNotice;
    };

export function workstreamRestoreCommand(snapshotContentHash: string): string {
  return `lervo workstream reconcile --restore ${snapshotContentHash}`;
}

/** Reads one exact stored revision; a Hub that predates the read fails with `hub_unavailable`. */
export async function readHubWorkstreamRevision(
  input: WorkstreamDivergenceCycle,
  snapshotContentHash: string,
): Promise<LocalWorkstreamRevision & { isHead: boolean }> {
  if (input.transport.readWorkstreamRevision === undefined)
    throw new WorkstreamReplicationCycleError(
      "hub_unavailable",
      "The Hub transport cannot read an exact workstream revision.",
    );
  let response: unknown;
  try {
    response = await input.transport.readWorkstreamRevision(snapshotContentHash);
  } catch (error) {
    throw new WorkstreamReplicationCycleError(
      "hub_unavailable",
      "The Hub workstream revision query failed.",
      { cause: error },
    );
  }
  let body: unknown;
  try {
    body = authenticatedResponseBody({
      response,
      destinationId: input.destinationId,
      expectedPeerIdentityHash: input.expectedPeerIdentityHash,
    });
  } catch (error) {
    throw new WorkstreamReplicationCycleError(
      "invalid_hub_response",
      "The Hub workstream revision peer identity is invalid.",
      { cause: error },
    );
  }
  const revision = body as WorkstreamReplicationRevisionResponse;
  if (
    !validateSchema("workstreamReplicationRevisionResponse", body).valid ||
    revision.projectId !== input.registration.project.projectId ||
    revision.repositoryIdentityHash !== input.registration.projectIdentityHash ||
    revision.revision.snapshotContentHash !== snapshotContentHash ||
    revision.revision.workstreamId !== revision.snapshot.workstreamId ||
    revision.revision.revision !== revision.snapshot.revision
  )
    throw new WorkstreamReplicationCycleError(
      "invalid_hub_response",
      "The Hub workstream revision response is invalid.",
    );
  return {
    snapshot: revision.snapshot,
    snapshotContentHash,
    previousSnapshotContentHash: revision.revision.previousSnapshotContentHash,
    isHead: revision.isHead,
  };
}

/** Publishes one revision and imports it locally once the Hub holds it as the unique head. */
async function publishAndImport(
  input: WorkstreamDivergenceCycle,
  revision: LocalWorkstreamRevision,
): Promise<void> {
  try {
    await input.transport.publishWorkstream({
      schemaVersion: 1,
      registrationId: input.registration.registrationId,
      projectId: input.registration.project.projectId,
      repositoryIdentityHash: input.registration.projectIdentityHash,
      ...structuredClone(revision),
    });
  } catch (error) {
    throw new WorkstreamReplicationCycleError(
      "hub_unavailable",
      "The Hub workstream publication failed.",
      { cause: error },
    );
  }
  const applied = await readHubWorkstream(input);
  if (
    applied.status !== "current" ||
    applied.heads[0]?.snapshotContentHash !== revision.snapshotContentHash
  )
    throw new WorkstreamReplicationCycleError(
      "replication_conflict",
      "The Hub did not retain the exact workstream revision.",
    );
  try {
    await input.local.importCurrent(structuredClone(revision));
  } catch (error) {
    throw new WorkstreamReplicationCycleError(
      "local_state_invalid",
      "The reconciled workstream could not be committed locally.",
      { cause: error },
    );
  }
}

async function localCurrent(input: WorkstreamDivergenceCycle): Promise<LocalWorkstreamRevision> {
  const current = (await input.local.readRevisionChain()).at(-1);
  if (current === undefined)
    throw new WorkstreamReplicationCycleError(
      "local_state_invalid",
      "A local checkpoint is required for reconciliation.",
    );
  return current;
}

/**
 * ADR-0561: when the local and Hub heads diverge, keep the newest valid head as a successor that
 * names both and preserve the other on the Hub, instead of asking the owner to choose. The caller
 * runs the replication cycle first, so the local head is already published.
 */
export async function reconcileDivergentWorkstream(
  input: WorkstreamDivergenceCycle,
): Promise<WorkstreamDivergenceResult> {
  const current = await localCurrent(input);
  const remote = await readHubWorkstream(input);
  if (remote.status !== "divergent") return { status: "not_divergent" };
  const headCount = remote.heads.length;
  if (!remote.heads.some((head) => head.snapshotContentHash === current.snapshotContentHash))
    return { status: "held", reason: "local_head_unpublished", headCount };
  const peers = remote.heads.filter(
    (head) => head.snapshotContentHash !== current.snapshotContentHash,
  );
  if (peers.length !== 1) return { status: "held", reason: "more_than_two_heads", headCount };
  const peer = await readHubWorkstreamRevision(input, peers[0]!.snapshotContentHash);
  if (!peer.isHead)
    throw new WorkstreamReplicationCycleError(
      "replication_conflict",
      "The Hub head changed before reconciliation.",
    );
  const plan = planWorkstreamReconciliation({
    projectId: input.registration.project.projectId,
    local: current,
    peer,
  });
  await publishAndImport(input, plan.revision);
  return {
    status: "reconciled",
    planId: plan.planId,
    kept: plan.kept,
    parents: plan.parents,
    preserved: plan.preserved,
    workstreamId: plan.revision.snapshot.workstreamId,
    snapshotContentHash: plan.revision.snapshotContentHash,
    notice: {
      effect: "workstream_reconciled",
      targets: [plan.revision.snapshot.workstreamId],
      reason: `Local and Hub workstream heads diverged; kept the newer ${plan.kept} head and preserved ${plan.preserved.snapshotContentHash} on the Hub.`,
      crossCheck: { reviewers: ["hub_exact_parent_check"], verdict: "agree" },
      undo: workstreamRestoreCommand(plan.preserved.snapshotContentHash),
    },
  };
}

/** The undo of a reconciliation: the preserved parent's body becomes the next revision. */
export async function restoreReconciledWorkstreamHead(
  input: WorkstreamDivergenceCycle & { snapshotContentHash: string; now: string },
): Promise<{
  workstreamId: string;
  revision: number;
  snapshotContentHash: string;
  notice: WorkstreamReconciliationNotice;
}> {
  const current = await localCurrent(input);
  const remote = await readHubWorkstream(input);
  if (
    remote.status !== "current" ||
    remote.heads[0]?.snapshotContentHash !== current.snapshotContentHash
  )
    throw new WorkstreamReplicationCycleError(
      "replication_conflict",
      "Restore requires the local checkpoint to be the Hub's unique current head; run lervo workstream sync first.",
    );
  const preserved = await readHubWorkstreamRevision(input, input.snapshotContentHash);
  const restored = planWorkstreamHeadRestore({ current, preserved, now: input.now });
  await publishAndImport(input, restored);
  return {
    workstreamId: restored.snapshot.workstreamId,
    revision: restored.snapshot.revision,
    snapshotContentHash: restored.snapshotContentHash,
    notice: {
      effect: "workstream_head_restored",
      targets: [restored.snapshot.workstreamId],
      reason: `Restored the preserved head ${input.snapshotContentHash} as revision ${restored.snapshot.revision}.`,
      crossCheck: { reviewers: ["hub_exact_parent_check"], verdict: "agree" },
      undo: workstreamRestoreCommand(current.snapshotContentHash),
    },
  };
}
