import { RepositoryCoordinationRecords } from "@lervo/project-storage";

import type {
  WorkspaceIntegrationAttempt,
  WorkspaceIntegrationAttemptEvent,
  WorkspaceIntegrationAttemptState,
} from "./integration-attempt-types.js";
import { AgentWorkforceError } from "./types.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_-]{8,128}$/u;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function validTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function isWorkspaceIntegrationAttempt(value: WorkspaceIntegrationAttempt): boolean {
  return (
    value.schemaVersion === 1 &&
    /^int_[a-f0-9]{24}$/u.test(value.attemptId) &&
    /^itl_[a-f0-9]{24}$/u.test(value.targetLeaseId) &&
    HASH.test(value.planContentHash) &&
    /^rpi_[a-f0-9]{24}$/u.test(value.repositoryInstanceId) &&
    HASH.test(value.targetDigest) &&
    Number.isSafeInteger(value.targetGeneration) &&
    value.targetGeneration >= 1 &&
    COMMIT.test(value.targetBeforeCommit) &&
    /^asn_[a-f0-9]{24}$/u.test(value.integrationAssignmentId) &&
    /^agt_[a-f0-9]{24}$/u.test(value.integratorAgentId) &&
    /^wsp_[a-f0-9]{24}$/u.test(value.integratorWorkspaceId) &&
    Number.isSafeInteger(value.integratorWorkspaceGeneration) &&
    value.integratorWorkspaceGeneration >= 1 &&
    value.sources.length > 0 &&
    value.sources.length <= 32 &&
    value.sources.every(
      (source) =>
        /^wsp_[a-f0-9]{24}$/u.test(source.workspaceId) &&
        Number.isSafeInteger(source.generation) &&
        source.generation >= 1 &&
        COMMIT.test(source.headCommit) &&
        COMMIT.test(source.treeHash) &&
        ["fast_forward", "cherry_pick", "merge"].includes(source.strategy),
    ) &&
    new Set(value.sources.map((source) => source.workspaceId)).size === value.sources.length &&
    ["leased", "candidate", "conflict"].includes(value.state) &&
    (value.candidateCommit === null || COMMIT.test(value.candidateCommit)) &&
    (value.candidateTreeHash === null || COMMIT.test(value.candidateTreeHash)) &&
    (value.conflictWorkspaceId === null || /^wsp_[a-f0-9]{24}$/u.test(value.conflictWorkspaceId)) &&
    (value.conflictReason === null || value.conflictReason === "git_conflict") &&
    ((value.state === "leased" &&
      value.candidateCommit === null &&
      value.candidateTreeHash === null &&
      value.conflictWorkspaceId === null &&
      value.conflictReason === null) ||
      (value.state === "candidate" &&
        value.candidateCommit !== null &&
        value.candidateTreeHash !== null &&
        value.conflictWorkspaceId === null &&
        value.conflictReason === null) ||
      (value.state === "conflict" &&
        value.candidateCommit === null &&
        value.candidateTreeHash === null &&
        value.conflictWorkspaceId !== null &&
        value.conflictReason === "git_conflict")) &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    validTime(value.createdAt) &&
    validTime(value.updatedAt)
  );
}

function eventFor(input: {
  eventId: string;
  current: WorkspaceIntegrationAttempt | null;
  next: WorkspaceIntegrationAttempt;
}): WorkspaceIntegrationAttemptEvent {
  if (!EVENT_ID.test(input.eventId)) invalid("The integration attempt event ID is invalid.");
  return {
    schemaVersion: 1,
    type: "assignment.integration.state.changed",
    eventId: input.eventId,
    occurredAt: input.next.updatedAt,
    attemptId: input.next.attemptId,
    targetLeaseId: input.next.targetLeaseId,
    repositoryInstanceId: input.next.repositoryInstanceId,
    targetDigest: input.next.targetDigest,
    targetGeneration: input.next.targetGeneration,
    targetBeforeCommit: input.next.targetBeforeCommit,
    integrationAssignmentId: input.next.integrationAssignmentId,
    integratorAgentId: input.next.integratorAgentId,
    integratorWorkspaceId: input.next.integratorWorkspaceId,
    sources: input.next.sources.map(({ workspaceId, generation, headCommit }) => ({
      workspaceId,
      generation,
      headCommit,
    })),
    previousState: input.current?.state ?? "absent",
    state: input.next.state,
    candidateCommit: input.next.candidateCommit,
    candidateTreeHash: input.next.candidateTreeHash,
    conflictWorkspaceId: input.next.conflictWorkspaceId,
    conflictReason: input.next.conflictReason,
    revision: input.next.revision,
  };
}

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
    if (stableJson(existing.attempt) !== stableJson(input.attempt))
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
    event: eventFor({ eventId: input.eventId, current: null, next: input.attempt }),
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
    !validTime(input.occurredAt)
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
    event: eventFor({ eventId: input.eventId, current: current.attempt, next }),
  });
  return { attempt: structuredClone(stored.value), contentHash: stored.contentHash };
}
