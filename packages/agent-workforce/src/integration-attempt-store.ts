import { RepositoryCoordinationRecords } from "@lervo/project-storage";

import {
  isWorkspaceIntegrationAttempt,
  stableWorkspaceIntegrationAttemptJson,
  validWorkspaceIntegrationTime,
  validWorkspaceIntegrationVerificationResult,
  workspaceIntegrationAttemptEvent,
  workspaceIntegrationRecordedEvent,
} from "./integration-attempt-contract.js";
import type {
  WorkspaceIntegrationAttempt,
  WorkspaceIntegrationAttemptState,
  WorkspaceIntegrationRecordedEvent,
  WorkspaceIntegrationVerificationCoordinate,
} from "./integration-attempt-types.js";
import { AgentWorkforceError } from "./types.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;

function invalid(message: string): never {
  throw new AgentWorkforceError("workspace_invalid", message);
}

export async function readWorkspaceIntegrationAttempt(
  repositoryRoot: string,
  targetLeaseId: string,
): Promise<{ attempt: WorkspaceIntegrationAttempt; contentHash: string } | null> {
  const records = await RepositoryCoordinationRecords.open(repositoryRoot);
  const stored = await records.read<WorkspaceIntegrationAttempt>(
    "integrationAttempts",
    targetLeaseId,
  );
  if (stored === null) return null;
  if (!isWorkspaceIntegrationAttempt(stored.value)) invalid("The integration attempt is invalid.");
  return { attempt: structuredClone(stored.value), contentHash: stored.contentHash };
}

export async function hasExactWorkspaceIntegrationRecordedEvent(input: {
  repositoryRoot: string;
  eventId: string;
  attempt: WorkspaceIntegrationAttempt;
}): Promise<boolean> {
  if (input.attempt.state !== "integrated") return false;
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const stored = await records.read<WorkspaceIntegrationRecordedEvent>("events", input.eventId);
  return (
    stored !== null &&
    stableWorkspaceIntegrationAttemptJson(stored.value) ===
      stableWorkspaceIntegrationAttemptJson(
        workspaceIntegrationRecordedEvent({ eventId: input.eventId, next: input.attempt }),
      )
  );
}

export async function acquireWorkspaceIntegrationTargetLease(input: {
  repositoryRoot: string;
  attempt: WorkspaceIntegrationAttempt;
  eventId: string;
}): Promise<{ attempt: WorkspaceIntegrationAttempt; contentHash: string }> {
  if (
    !isWorkspaceIntegrationAttempt(input.attempt) ||
    input.attempt.state !== "leased" ||
    input.attempt.revision !== 1
  )
    invalid("The first integration attempt state is invalid.");
  const existing = await readWorkspaceIntegrationAttempt(
    input.repositoryRoot,
    input.attempt.targetLeaseId,
  );
  if (existing !== null) {
    if (
      stableWorkspaceIntegrationAttemptJson(existing.attempt) !==
      stableWorkspaceIntegrationAttemptJson(input.attempt)
    )
      throw new AgentWorkforceError(
        "workspace_transition_conflict",
        "The target generation already has a different integration lease.",
      );
    return existing;
  }
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const stored = await records.writeTransition({
    collection: "integrationAttempts",
    recordId: input.attempt.targetLeaseId,
    value: input.attempt,
    expectedContentHash: null,
    eventId: input.eventId,
    event: workspaceIntegrationAttemptEvent({
      eventId: input.eventId,
      current: null,
      next: input.attempt,
    }),
  });
  return { attempt: structuredClone(stored.value), contentHash: stored.contentHash };
}

export async function updateWorkspaceIntegrationAttempt(input: {
  repositoryRoot: string;
  targetLeaseId: string;
  expectedContentHash: string;
  expectedRevision: number;
  eventId: string;
  nextState: Extract<WorkspaceIntegrationAttemptState, "candidate" | "conflict">;
  occurredAt: string;
  candidateCommit?: string;
  candidateTreeHash?: string;
  conflictWorkspaceId?: string;
  conflictReason?: "git_conflict";
}): Promise<{ attempt: WorkspaceIntegrationAttempt; contentHash: string }> {
  const current = await readWorkspaceIntegrationAttempt(input.repositoryRoot, input.targetLeaseId);
  if (
    current === null ||
    current.contentHash !== input.expectedContentHash ||
    current.attempt.revision !== input.expectedRevision ||
    current.attempt.state !== "leased" ||
    !validWorkspaceIntegrationTime(input.occurredAt)
  )
    throw new AgentWorkforceError(
      "workspace_transition_conflict",
      "The integration attempt changed before apply.",
    );
  const next: WorkspaceIntegrationAttempt = {
    ...current.attempt,
    state: input.nextState,
    candidateCommit: input.candidateCommit ?? null,
    candidateTreeHash: input.candidateTreeHash ?? null,
    verificationReceiptHash: null,
    verificationResults: [],
    targetAfterCommit: null,
    conflictWorkspaceId: input.conflictWorkspaceId ?? null,
    conflictReason: input.conflictReason ?? null,
    revision: current.attempt.revision + 1,
    updatedAt: input.occurredAt,
  };
  if (!isWorkspaceIntegrationAttempt(next))
    invalid("The resulting integration attempt is invalid.");
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const stored = await records.writeTransition({
    collection: "integrationAttempts",
    recordId: input.targetLeaseId,
    value: next,
    expectedContentHash: current.contentHash,
    eventId: input.eventId,
    event: workspaceIntegrationAttemptEvent({
      eventId: input.eventId,
      current: current.attempt,
      next,
    }),
  });
  return { attempt: structuredClone(stored.value), contentHash: stored.contentHash };
}

export async function beginWorkspaceIntegrationAdvancement(input: {
  repositoryRoot: string;
  targetLeaseId: string;
  expectedContentHash: string;
  expectedRevision: number;
  eventId: string;
  occurredAt: string;
  verificationReceiptHash: string;
  verificationResults: WorkspaceIntegrationVerificationCoordinate[];
}): Promise<{ attempt: WorkspaceIntegrationAttempt; contentHash: string }> {
  const current = await readWorkspaceIntegrationAttempt(input.repositoryRoot, input.targetLeaseId);
  if (
    current === null ||
    current.contentHash !== input.expectedContentHash ||
    current.attempt.revision !== input.expectedRevision ||
    current.attempt.state !== "candidate" ||
    current.attempt.candidateCommit === null ||
    !validWorkspaceIntegrationTime(input.occurredAt) ||
    !HASH.test(input.verificationReceiptHash) ||
    input.verificationResults.length === 0 ||
    !input.verificationResults.every(validWorkspaceIntegrationVerificationResult)
  )
    throw new AgentWorkforceError(
      "workspace_transition_conflict",
      "The integration advancement coordinate changed before apply.",
    );
  const next: WorkspaceIntegrationAttempt = {
    ...current.attempt,
    state: "advancing",
    verificationReceiptHash: input.verificationReceiptHash,
    verificationResults: structuredClone(input.verificationResults),
    targetAfterCommit: current.attempt.candidateCommit,
    revision: current.attempt.revision + 1,
    updatedAt: input.occurredAt,
  };
  if (!isWorkspaceIntegrationAttempt(next)) invalid("The advancing attempt is invalid.");
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const stored = await records.writeTransition({
    collection: "integrationAttempts",
    recordId: input.targetLeaseId,
    value: next,
    expectedContentHash: current.contentHash,
    eventId: input.eventId,
    event: workspaceIntegrationAttemptEvent({
      eventId: input.eventId,
      current: current.attempt,
      next,
    }),
  });
  return { attempt: structuredClone(stored.value), contentHash: stored.contentHash };
}

export async function commitWorkspaceIntegrationAttempt(input: {
  repositoryRoot: string;
  targetLeaseId: string;
  expectedContentHash: string;
  expectedRevision: number;
  eventId: string;
  occurredAt: string;
}): Promise<{ attempt: WorkspaceIntegrationAttempt; contentHash: string }> {
  const current = await readWorkspaceIntegrationAttempt(input.repositoryRoot, input.targetLeaseId);
  if (
    current === null ||
    current.contentHash !== input.expectedContentHash ||
    current.attempt.revision !== input.expectedRevision ||
    current.attempt.state !== "advancing" ||
    !validWorkspaceIntegrationTime(input.occurredAt)
  )
    throw new AgentWorkforceError(
      "workspace_transition_conflict",
      "The integration success coordinate changed before commit.",
    );
  const next: WorkspaceIntegrationAttempt = {
    ...current.attempt,
    state: "integrated",
    revision: current.attempt.revision + 1,
    updatedAt: input.occurredAt,
  };
  if (!isWorkspaceIntegrationAttempt(next)) invalid("The integrated attempt is invalid.");
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const stored = await records.writeTransition({
    collection: "integrationAttempts",
    recordId: input.targetLeaseId,
    value: next,
    expectedContentHash: current.contentHash,
    eventId: input.eventId,
    event: workspaceIntegrationRecordedEvent({ eventId: input.eventId, next }),
  });
  return { attempt: structuredClone(stored.value), contentHash: stored.contentHash };
}

export async function rollbackWorkspaceIntegrationAdvancement(input: {
  repositoryRoot: string;
  targetLeaseId: string;
  expectedContentHash: string;
  expectedRevision: number;
  eventId: string;
  occurredAt: string;
}): Promise<{ attempt: WorkspaceIntegrationAttempt; contentHash: string }> {
  const current = await readWorkspaceIntegrationAttempt(input.repositoryRoot, input.targetLeaseId);
  if (
    current === null ||
    current.contentHash !== input.expectedContentHash ||
    current.attempt.revision !== input.expectedRevision ||
    current.attempt.state !== "advancing" ||
    !validWorkspaceIntegrationTime(input.occurredAt)
  )
    throw new AgentWorkforceError(
      "workspace_transition_conflict",
      "The integration rollback coordinate changed before apply.",
    );
  const next: WorkspaceIntegrationAttempt = {
    ...current.attempt,
    state: "candidate",
    verificationReceiptHash: null,
    verificationResults: [],
    targetAfterCommit: null,
    revision: current.attempt.revision + 1,
    updatedAt: input.occurredAt,
  };
  if (!isWorkspaceIntegrationAttempt(next)) invalid("The rolled back attempt is invalid.");
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const stored = await records.writeTransition({
    collection: "integrationAttempts",
    recordId: input.targetLeaseId,
    value: next,
    expectedContentHash: current.contentHash,
    eventId: input.eventId,
    event: workspaceIntegrationAttemptEvent({
      eventId: input.eventId,
      current: current.attempt,
      next,
    }),
  });
  return { attempt: structuredClone(stored.value), contentHash: stored.contentHash };
}
