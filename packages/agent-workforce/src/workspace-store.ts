import { RepositoryCoordinationRecords } from "@lervo/project-storage";

import { AgentWorkforceError } from "./types.js";
import { isAgentWorkspace, transitionWorkspace } from "./workspace-lifecycle.js";
import type { AgentWorkspace, WorkspaceState } from "./workspace-types.js";

const EVENT_ID = /^evt_[A-Za-z0-9_-]{8,128}$/u;

export interface WorkspaceCoordinationEvent {
  schemaVersion: 1;
  eventId: string;
  type:
    | "agent.workspace.provisioned"
    | "agent.workspace.state.changed"
    | "agent.workspace.sealed"
    | "assignment.integration.recorded"
    | "agent.workspace.removed";
  occurredAt: string;
  workspaceId: string;
  generation: number;
  assignmentId: string;
  agentId: string;
  repositoryInstanceId: string;
  hostKind: "git" | "orca";
  hostVersion: string;
  baseCommit: string;
  integrationTargetDigest: string;
  previousState: WorkspaceState | "absent";
  state: WorkspaceState;
  reasonCode: string | null;
  headCommit: string | null;
  treeHash: string | null;
  changedPathSetDigest: string | null;
  changedPathCount: number | null;
  integrationEvidenceId: string | null;
  cleanupPlanId: string | null;
  revision: number;
}

function invalid(message: string): never {
  throw new AgentWorkforceError("workspace_invalid", message);
}

function eventFor(input: {
  eventId: string;
  current: AgentWorkspace | null;
  next: AgentWorkspace;
  reasonCode?: string;
}): WorkspaceCoordinationEvent {
  if (!EVENT_ID.test(input.eventId)) invalid("The workspace event ID is invalid.");
  const type =
    input.next.state === "provisioning"
      ? "agent.workspace.provisioned"
      : input.next.state === "sealed"
        ? "agent.workspace.sealed"
        : input.next.state === "integrated"
          ? "assignment.integration.recorded"
          : input.next.state === "removed"
            ? "agent.workspace.removed"
            : "agent.workspace.state.changed";
  return {
    schemaVersion: 1,
    eventId: input.eventId,
    type,
    occurredAt: input.next.updatedAt,
    workspaceId: input.next.workspaceId,
    generation: input.next.generation,
    assignmentId: input.next.assignmentId,
    agentId: input.next.agentId,
    repositoryInstanceId: input.next.repositoryInstanceId,
    hostKind: input.next.host.kind,
    hostVersion: input.next.host.version,
    baseCommit: input.next.baseCommit,
    integrationTargetDigest: input.next.integrationTargetDigest,
    previousState: input.current?.state ?? "absent",
    state: input.next.state,
    reasonCode: input.reasonCode ?? null,
    headCommit: input.next.sealedResult?.headCommit ?? null,
    treeHash: input.next.sealedResult?.treeHash ?? null,
    changedPathSetDigest: input.next.sealedResult?.changedPathSetDigest ?? null,
    changedPathCount: input.next.sealedResult?.changedPathCount ?? null,
    integrationEvidenceId: input.next.integrationEvidenceId,
    cleanupPlanId: input.next.cleanupPlanId,
    revision: input.next.revision,
  };
}

export async function readWorkspace(
  repositoryRoot: string,
  workspaceId: string,
): Promise<{ workspace: AgentWorkspace; contentHash: string } | null> {
  const records = await RepositoryCoordinationRecords.open(repositoryRoot);
  const record = await records.read<AgentWorkspace>("workspaces", workspaceId);
  if (record === null) return null;
  if (!isAgentWorkspace(record.value) || record.value.workspaceId !== workspaceId)
    invalid("The stored workspace record is invalid.");
  return { workspace: structuredClone(record.value), contentHash: record.contentHash };
}

export async function listWorkspaces(repositoryRoot: string): Promise<AgentWorkspace[]> {
  const records = await RepositoryCoordinationRecords.open(repositoryRoot);
  const stored = await records.list<AgentWorkspace>("workspaces");
  if (stored.some((record) => !isAgentWorkspace(record.value)))
    invalid("A stored workspace record is invalid.");
  return stored
    .map((record) => structuredClone(record.value))
    .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId));
}

export async function createWorkspace(input: {
  repositoryRoot: string;
  workspace: AgentWorkspace;
  eventId: string;
}): Promise<AgentWorkspace> {
  if (
    !isAgentWorkspace(input.workspace) ||
    input.workspace.state !== "provisioning" ||
    input.workspace.revision !== 1
  )
    invalid("A new workspace must be a valid first provisioning generation.");
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const result = await records.writeTransition({
    collection: "workspaces",
    recordId: input.workspace.workspaceId,
    value: input.workspace,
    expectedContentHash: null,
    eventId: input.eventId,
    event: eventFor({ eventId: input.eventId, current: null, next: input.workspace }),
  });
  return structuredClone(result.value);
}

export async function updateWorkspace(
  input: Omit<Parameters<typeof transitionWorkspace>[0], "current"> & {
    repositoryRoot: string;
    workspaceId: string;
    expectedContentHash: string;
    eventId: string;
    reasonCode?: string;
  },
): Promise<{ workspace: AgentWorkspace; contentHash: string }> {
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const stored = await records.read<AgentWorkspace>("workspaces", input.workspaceId);
  if (
    stored === null ||
    stored.contentHash !== input.expectedContentHash ||
    !isAgentWorkspace(stored.value)
  )
    throw new AgentWorkforceError(
      "workspace_transition_conflict",
      "The workspace record changed before apply.",
    );
  const {
    repositoryRoot: _repositoryRoot,
    workspaceId: _workspaceId,
    expectedContentHash: _expectedContentHash,
    eventId,
    reasonCode,
    ...transition
  } = input;
  const next = transitionWorkspace({ ...transition, current: stored.value });
  const result = await records.writeTransition({
    collection: "workspaces",
    recordId: input.workspaceId,
    value: next,
    expectedContentHash: stored.contentHash,
    eventId,
    event: eventFor({
      eventId,
      current: stored.value,
      next,
      ...(reasonCode === undefined ? {} : { reasonCode }),
    }),
  });
  return { workspace: structuredClone(result.value), contentHash: result.contentHash };
}
