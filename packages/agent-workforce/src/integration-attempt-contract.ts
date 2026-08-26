import type {
  WorkspaceIntegrationAttempt,
  WorkspaceIntegrationAttemptEvent,
  WorkspaceIntegrationRecordedEvent,
  WorkspaceIntegrationVerificationCoordinate,
} from "./integration-attempt-types.js";
import { AgentWorkforceError } from "./types.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;
const EVENT_ID = /^evt_[A-Za-z0-9_-]{8,128}$/u;

export function stableWorkspaceIntegrationAttemptJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableWorkspaceIntegrationAttemptJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableWorkspaceIntegrationAttemptJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function validWorkspaceIntegrationTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function validWorkspaceIntegrationVerificationResult(
  value: WorkspaceIntegrationVerificationCoordinate,
): boolean {
  return (
    /^[a-z][a-z0-9._-]{1,99}$/u.test(value.suiteId) &&
    HASH.test(value.suiteHash) &&
    /^ver_[A-Za-z0-9_-]{8,128}$/u.test(value.verificationId) &&
    /^art_[A-Za-z0-9_-]{8,128}$/u.test(value.resultArtifactId) &&
    HASH.test(value.resultContentHash)
  );
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
    ["leased", "candidate", "advancing", "integrated", "conflict"].includes(value.state) &&
    (value.candidateCommit === null || COMMIT.test(value.candidateCommit)) &&
    (value.candidateTreeHash === null || COMMIT.test(value.candidateTreeHash)) &&
    (value.verificationReceiptHash === null || HASH.test(value.verificationReceiptHash)) &&
    value.verificationResults.length <= 64 &&
    value.verificationResults.every(validWorkspaceIntegrationVerificationResult) &&
    (value.targetAfterCommit === null || COMMIT.test(value.targetAfterCommit)) &&
    (value.conflictWorkspaceId === null || /^wsp_[a-f0-9]{24}$/u.test(value.conflictWorkspaceId)) &&
    (value.conflictReason === null || value.conflictReason === "git_conflict") &&
    ((value.state === "leased" &&
      value.candidateCommit === null &&
      value.candidateTreeHash === null &&
      value.verificationReceiptHash === null &&
      value.verificationResults.length === 0 &&
      value.targetAfterCommit === null &&
      value.conflictWorkspaceId === null &&
      value.conflictReason === null) ||
      (value.state === "candidate" &&
        value.candidateCommit !== null &&
        value.candidateTreeHash !== null &&
        value.verificationReceiptHash === null &&
        value.verificationResults.length === 0 &&
        value.targetAfterCommit === null &&
        value.conflictWorkspaceId === null &&
        value.conflictReason === null) ||
      (["advancing", "integrated"].includes(value.state) &&
        value.candidateCommit !== null &&
        value.candidateTreeHash !== null &&
        value.verificationReceiptHash !== null &&
        value.verificationResults.length > 0 &&
        value.targetAfterCommit === value.candidateCommit &&
        value.conflictWorkspaceId === null &&
        value.conflictReason === null) ||
      (value.state === "conflict" &&
        value.candidateCommit === null &&
        value.candidateTreeHash === null &&
        value.verificationReceiptHash === null &&
        value.verificationResults.length === 0 &&
        value.targetAfterCommit === null &&
        value.conflictWorkspaceId !== null &&
        value.conflictReason === "git_conflict")) &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 1 &&
    validWorkspaceIntegrationTime(value.createdAt) &&
    validWorkspaceIntegrationTime(value.updatedAt)
  );
}

function assertEventId(eventId: string): void {
  if (!EVENT_ID.test(eventId))
    throw new AgentWorkforceError("workspace_invalid", "The integration event ID is invalid.");
}

export function workspaceIntegrationAttemptEvent(input: {
  eventId: string;
  current: WorkspaceIntegrationAttempt | null;
  next: WorkspaceIntegrationAttempt;
}): WorkspaceIntegrationAttemptEvent {
  assertEventId(input.eventId);
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
    verificationReceiptHash: input.next.verificationReceiptHash,
    targetAfterCommit: input.next.targetAfterCommit,
    conflictWorkspaceId: input.next.conflictWorkspaceId,
    conflictReason: input.next.conflictReason,
    revision: input.next.revision,
  };
}

export function workspaceIntegrationRecordedEvent(input: {
  eventId: string;
  next: WorkspaceIntegrationAttempt;
}): WorkspaceIntegrationRecordedEvent {
  assertEventId(input.eventId);
  if (
    input.next.state !== "integrated" ||
    input.next.targetAfterCommit === null ||
    input.next.verificationReceiptHash === null
  )
    throw new AgentWorkforceError(
      "workspace_invalid",
      "The integration recorded event requires an integrated attempt.",
    );
  return {
    schemaVersion: 1,
    type: "assignment.integration.recorded",
    eventId: input.eventId,
    occurredAt: input.next.updatedAt,
    attemptId: input.next.attemptId,
    targetLeaseId: input.next.targetLeaseId,
    repositoryInstanceId: input.next.repositoryInstanceId,
    targetDigest: input.next.targetDigest,
    targetGeneration: input.next.targetGeneration,
    integrationAssignmentId: input.next.integrationAssignmentId,
    integratorAgentId: input.next.integratorAgentId,
    integratorWorkspaceId: input.next.integratorWorkspaceId,
    sources: input.next.sources.map(({ workspaceId, generation, headCommit, strategy }) => ({
      workspaceId,
      generation,
      headCommit,
      strategy,
    })),
    targetBeforeCommit: input.next.targetBeforeCommit,
    targetAfterCommit: input.next.targetAfterCommit,
    verificationReceiptHash: input.next.verificationReceiptHash,
    verificationResults: structuredClone(input.next.verificationResults),
    revision: input.next.revision,
  };
}
