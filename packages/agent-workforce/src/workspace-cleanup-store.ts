import { RepositoryCoordinationRecords } from "@lervo/project-storage";

import { AgentWorkforceError } from "./types.js";
import type { WorkspaceCleanupJournal } from "./workspace-cleanup-types.js";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const COMMIT = /^[a-f0-9]{40,64}$/u;

function invalid(message: string): never {
  throw new AgentWorkforceError("workspace_invalid", message);
}

function validTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

export function isWorkspaceCleanupJournal(value: WorkspaceCleanupJournal): boolean {
  return (
    value.schemaVersion === 1 &&
    /^wcj_[a-f0-9]{24}$/u.test(value.journalId) &&
    /^wcp_[a-f0-9]{24}$/u.test(value.planId) &&
    HASH.test(value.planContentHash) &&
    /^wsp_[a-f0-9]{24}$/u.test(value.workspaceId) &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 1 &&
    /^rpi_[a-f0-9]{24}$/u.test(value.repositoryInstanceId) &&
    value.repositoryRoot.length > 0 &&
    value.workspacePath.length > 0 &&
    COMMIT.test(value.baseCommit) &&
    COMMIT.test(value.integratedHeadCommit) &&
    value.marker.workspaceId === value.workspaceId &&
    value.marker.generation === value.generation &&
    value.marker.repositoryInstanceId === value.repositoryInstanceId &&
    /^idk_[A-Za-z0-9_-]{8,128}$/u.test(value.idempotencyKey) &&
    ["prepared", "removal_observed"].includes(value.phase) &&
    (value.removalObservedAt === null || validTime(value.removalObservedAt)) &&
    validTime(value.createdAt) &&
    validTime(value.updatedAt) &&
    Date.parse(value.updatedAt) >= Date.parse(value.createdAt) &&
    (value.phase === "prepared"
      ? value.removalObservedAt === null
      : value.removalObservedAt !== null)
  );
}

export async function readWorkspaceCleanupJournal(
  repositoryRoot: string,
  journalId: string,
): Promise<{ journal: WorkspaceCleanupJournal; contentHash: string } | null> {
  const records = await RepositoryCoordinationRecords.open(repositoryRoot);
  const record = await records.read<WorkspaceCleanupJournal>("cleanupJournals", journalId);
  if (record === null) return null;
  if (!isWorkspaceCleanupJournal(record.value) || record.value.journalId !== journalId)
    invalid("The stored workspace cleanup journal is invalid.");
  return { journal: structuredClone(record.value), contentHash: record.contentHash };
}

export async function createWorkspaceCleanupJournal(input: {
  repositoryRoot: string;
  journal: WorkspaceCleanupJournal;
}): Promise<{ journal: WorkspaceCleanupJournal; contentHash: string }> {
  if (!isWorkspaceCleanupJournal(input.journal) || input.journal.phase !== "prepared")
    invalid("A new workspace cleanup journal must be a valid prepared record.");
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const result = await records.write({
    collection: "cleanupJournals",
    recordId: input.journal.journalId,
    value: input.journal,
    expectedContentHash: null,
  });
  return { journal: structuredClone(result.value), contentHash: result.contentHash };
}

export async function recordWorkspaceCleanupRemoval(input: {
  repositoryRoot: string;
  journalId: string;
  expectedContentHash: string;
  observedAt: string;
}): Promise<{ journal: WorkspaceCleanupJournal; contentHash: string }> {
  const current = await readWorkspaceCleanupJournal(input.repositoryRoot, input.journalId);
  if (
    current === null ||
    current.contentHash !== input.expectedContentHash ||
    current.journal.phase !== "prepared" ||
    !validTime(input.observedAt) ||
    Date.parse(input.observedAt) < Date.parse(current.journal.updatedAt)
  )
    throw new AgentWorkforceError(
      "workspace_transition_conflict",
      "The workspace cleanup journal changed before removal was recorded.",
    );
  const next: WorkspaceCleanupJournal = {
    ...current.journal,
    phase: "removal_observed",
    removalObservedAt: input.observedAt,
    updatedAt: input.observedAt,
  };
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const result = await records.write({
    collection: "cleanupJournals",
    recordId: input.journalId,
    value: next,
    expectedContentHash: current.contentHash,
  });
  return { journal: structuredClone(result.value), contentHash: result.contentHash };
}

export async function clearWorkspaceCleanupJournal(input: {
  repositoryRoot: string;
  journalId: string;
  expectedContentHash: string;
}): Promise<boolean> {
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  return records.remove({
    collection: "cleanupJournals",
    recordId: input.journalId,
    expectedContentHash: input.expectedContentHash,
  });
}
