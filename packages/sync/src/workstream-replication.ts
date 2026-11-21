import {
  hasWorkstreamPredecessor,
  validateSchema,
  type ProjectRegistrationRequest,
  type WorkstreamReplicationPublishRequest,
  type WorkstreamReplicationPublishResponse,
  type WorkstreamReplicationReadResponse,
  type WorkstreamSnapshot,
} from "@lervo/schemas";

import { authenticatedResponseBody } from "./peer-response.js";
import type { AuthenticatedWorkstreamHubTransport } from "./transport.js";

export interface LocalWorkstreamRevision {
  snapshot: WorkstreamSnapshot;
  snapshotContentHash: string;
  previousSnapshotContentHash: string | null;
}

export interface WorkstreamReplicationLocalPort {
  readRevisionChain(): Promise<LocalWorkstreamRevision[]>;
  /**
   * ADR-0602: re-proves the exact revisions about to be published (their events, the anchor and
   * the artifacts) and throws if any changed since they were read.
   */
  verifyForPublish(revisions: readonly LocalWorkstreamRevision[]): Promise<void>;
  importCurrent(input: LocalWorkstreamRevision): Promise<void>;
}

export type WorkstreamReplicationCycleResult =
  | { status: "absent"; publishedCount: 0; imported: false; headCount: 0 }
  | { status: "current" | "published"; publishedCount: number; imported: false; headCount: 1 }
  | { status: "imported"; publishedCount: number; imported: true; headCount: 1 }
  | { status: "divergent"; publishedCount: number; imported: false; headCount: number };

export class WorkstreamReplicationCycleError extends Error {
  constructor(
    readonly code:
      "hub_unavailable" | "invalid_hub_response" | "local_state_invalid" | "replication_conflict",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkstreamReplicationCycleError";
  }
}

function bodyOf(input: {
  response: unknown;
  destinationId: string;
  expectedPeerIdentityHash: string;
}): unknown {
  try {
    return authenticatedResponseBody(input);
  } catch (error) {
    throw new WorkstreamReplicationCycleError(
      "invalid_hub_response",
      "The Hub workstream response peer identity is invalid.",
      { cause: error },
    );
  }
}

export async function readHubWorkstream(input: {
  transport: AuthenticatedWorkstreamHubTransport;
  registration: ProjectRegistrationRequest;
  destinationId: string;
  expectedPeerIdentityHash: string;
}): Promise<WorkstreamReplicationReadResponse> {
  let response: unknown;
  try {
    response = await input.transport.readWorkstream();
  } catch (error) {
    throw new WorkstreamReplicationCycleError(
      "hub_unavailable",
      "The Hub workstream query failed.",
      { cause: error },
    );
  }
  const body = bodyOf({
    response,
    destinationId: input.destinationId,
    expectedPeerIdentityHash: input.expectedPeerIdentityHash,
  });
  if (!validateSchema("workstreamReplicationReadResponse", body).valid) {
    throw new WorkstreamReplicationCycleError(
      "invalid_hub_response",
      "The Hub workstream query response is invalid.",
    );
  }
  const remote = body as WorkstreamReplicationReadResponse;
  if (
    remote.projectId !== input.registration.project.projectId ||
    remote.repositoryIdentityHash !== input.registration.projectIdentityHash
  ) {
    throw new WorkstreamReplicationCycleError(
      "invalid_hub_response",
      "The Hub workstream query response coordinates are invalid.",
    );
  }
  return remote;
}

function unpublishedLocalRevisions(
  revisions: LocalWorkstreamRevision[],
  remote: WorkstreamReplicationReadResponse,
): LocalWorkstreamRevision[] {
  const disclosedHeads = new Set(remote.heads.map((head) => head.snapshotContentHash));
  let matchedIndex = -1;
  for (const [index, revision] of revisions.entries()) {
    if (disclosedHeads.has(revision.snapshotContentHash)) matchedIndex = index;
  }
  return revisions.slice(matchedIndex + 1);
}

export async function runWorkstreamReplicationCycle(input: {
  local: WorkstreamReplicationLocalPort;
  transport: AuthenticatedWorkstreamHubTransport;
  registration: ProjectRegistrationRequest;
  destinationId: string;
  expectedPeerIdentityHash: string;
}): Promise<WorkstreamReplicationCycleResult> {
  let revisions: LocalWorkstreamRevision[];
  try {
    revisions = await input.local.readRevisionChain();
  } catch (error) {
    throw new WorkstreamReplicationCycleError(
      "local_state_invalid",
      "The local workstream chain is invalid.",
      { cause: error },
    );
  }
  const initialRemote = await readHubWorkstream(input);
  let publishedCount = 0;
  const unpublished = unpublishedLocalRevisions(revisions, initialRemote);
  if (unpublished.length > 0)
    try {
      await input.local.verifyForPublish(unpublished);
    } catch (error) {
      throw new WorkstreamReplicationCycleError(
        "local_state_invalid",
        "The local workstream history changed before publication.",
        { cause: error },
      );
    }
  for (const revision of unpublished) {
    const request: WorkstreamReplicationPublishRequest = {
      schemaVersion: 1,
      registrationId: input.registration.registrationId,
      projectId: input.registration.project.projectId,
      repositoryIdentityHash: input.registration.projectIdentityHash,
      snapshotContentHash: revision.snapshotContentHash,
      previousSnapshotContentHash: revision.previousSnapshotContentHash,
      snapshot: structuredClone(revision.snapshot),
    };
    let response: unknown;
    try {
      response = await input.transport.publishWorkstream(request);
    } catch (error) {
      throw new WorkstreamReplicationCycleError(
        "hub_unavailable",
        "The Hub workstream publication failed.",
        { cause: error },
      );
    }
    const body = bodyOf({
      response,
      destinationId: input.destinationId,
      expectedPeerIdentityHash: input.expectedPeerIdentityHash,
    });
    if (!validateSchema("workstreamReplicationPublishResponse", body).valid) {
      throw new WorkstreamReplicationCycleError(
        "invalid_hub_response",
        "The Hub workstream publication response is invalid.",
      );
    }
    const result = body as WorkstreamReplicationPublishResponse;
    if (
      result.projectId !== input.registration.project.projectId ||
      result.repositoryIdentityHash !== input.registration.projectIdentityHash
    ) {
      throw new WorkstreamReplicationCycleError(
        "invalid_hub_response",
        "The Hub workstream publication response coordinates are invalid.",
      );
    }
    if (result.status !== "duplicate") publishedCount += 1;
  }

  const remote = unpublished.length === 0 ? initialRemote : await readHubWorkstream(input);
  if (remote.status === "not_found") {
    if (revisions.length !== 0) {
      throw new WorkstreamReplicationCycleError(
        "replication_conflict",
        "The Hub lost a successfully published workstream revision.",
      );
    }
    return { status: "absent", publishedCount: 0, imported: false, headCount: 0 };
  }
  if (remote.status === "divergent") {
    return { status: "divergent", publishedCount, imported: false, headCount: remote.heads.length };
  }
  if (remote.snapshot === null || remote.heads.length !== 1) {
    throw new WorkstreamReplicationCycleError(
      "invalid_hub_response",
      "The current Hub workstream response is incomplete.",
    );
  }
  const head = remote.heads[0]!;
  const localCurrent = revisions.at(-1) ?? null;
  if (localCurrent?.snapshotContentHash === head.snapshotContentHash) {
    return {
      status: publishedCount === 0 ? "current" : "published",
      publishedCount,
      imported: false,
      headCount: 1,
    };
  }
  const sameWorkstreamAdvance =
    localCurrent !== null &&
    remote.snapshot.workstreamId === localCurrent.snapshot.workstreamId &&
    remote.snapshot.revision > localCurrent.snapshot.revision;
  const successorAdvance =
    localCurrent !== null &&
    hasWorkstreamPredecessor(remote.snapshot, {
      ...localCurrent.snapshot,
      snapshotContentHash: localCurrent.snapshotContentHash,
    });
  if (localCurrent !== null && !sameWorkstreamAdvance && !successorAdvance) {
    throw new WorkstreamReplicationCycleError(
      "replication_conflict",
      "A unique Hub head does not safely advance the local workstream.",
    );
  }
  try {
    await input.local.importCurrent({
      snapshot: structuredClone(remote.snapshot),
      snapshotContentHash: head.snapshotContentHash,
      previousSnapshotContentHash: head.previousSnapshotContentHash,
    });
  } catch (error) {
    throw new WorkstreamReplicationCycleError(
      "local_state_invalid",
      "The replicated workstream could not be committed locally.",
      { cause: error },
    );
  }
  return { status: "imported", publishedCount, imported: true, headCount: 1 };
}
