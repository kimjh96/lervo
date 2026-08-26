import { RepositoryCoordinationRecords } from "@lervo/project-storage";

import { AgentWorkforceError } from "./types.js";
import { isAgentWorkspace, transitionWorkspace } from "./workspace-lifecycle.js";
import type { AgentWorkspace, WorkspaceCheckpoint, WorkspaceState } from "./workspace-types.js";

const EVENT_ID = /^evt_[A-Za-z0-9_-]{8,128}$/u;
const WORKSPACE_STATES: WorkspaceState[] = [
  "provisioning",
  "ready",
  "active",
  "sealing",
  "sealed",
  "integration_pending",
  "integrating",
  "integrated",
  "integration_conflict",
  "cleanup_eligible",
  "removing",
  "removed",
  "recovery_required",
];
const WORKSPACE_EVENT_TYPES: WorkspaceCoordinationEvent["type"][] = [
  "agent.workspace.provisioned",
  "agent.workspace.state.changed",
  "agent.workspace.sealed",
  "agent.workspace.removed",
];

export interface WorkspaceCoordinationEvent {
  schemaVersion: 1;
  eventId: string;
  type:
    | "agent.workspace.provisioned"
    | "agent.workspace.state.changed"
    | "agent.workspace.sealed"
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

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function isWorkspaceCheckpoint(value: WorkspaceCheckpoint): boolean {
  return (
    value.schemaVersion === 1 &&
    value.type === "agent.workspace.checkpointed" &&
    EVENT_ID.test(value.eventId) &&
    /^wsp_[a-f0-9]{24}$/u.test(value.workspaceId) &&
    Number.isSafeInteger(value.generation) &&
    value.generation >= 1 &&
    Number.isSafeInteger(value.workspaceRevision) &&
    value.workspaceRevision >= 1 &&
    /^asn_[a-f0-9]{24}$/u.test(value.assignmentId) &&
    Number.isSafeInteger(value.assignmentRevision) &&
    value.assignmentRevision >= 1 &&
    Number.isSafeInteger(value.leaseGeneration) &&
    value.leaseGeneration >= 1 &&
    /^ses_[A-Za-z0-9_-]{8,128}$/u.test(value.writerSessionId) &&
    /^[a-f0-9]{40,64}$/u.test(value.headCommit) &&
    /^[a-f0-9]{40,64}$/u.test(value.treeHash) &&
    /^sha256:[a-f0-9]{64}$/u.test(value.changedPathSetDigest) &&
    Number.isSafeInteger(value.changedPathCount) &&
    value.changedPathCount >= 0 &&
    Number.isFinite(Date.parse(value.occurredAt))
  );
}

function invalid(message: string): never {
  throw new AgentWorkforceError("workspace_invalid", message);
}

export function isWorkspaceCoordinationEvent(value: unknown): value is WorkspaceCoordinationEvent {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const event = value as WorkspaceCoordinationEvent;
  return (
    event.schemaVersion === 1 &&
    EVENT_ID.test(event.eventId) &&
    WORKSPACE_EVENT_TYPES.includes(event.type) &&
    Number.isFinite(Date.parse(event.occurredAt)) &&
    /^wsp_[a-f0-9]{24}$/u.test(event.workspaceId) &&
    Number.isSafeInteger(event.generation) &&
    event.generation >= 1 &&
    /^asn_[a-f0-9]{24}$/u.test(event.assignmentId) &&
    /^agt_[a-f0-9]{24}$/u.test(event.agentId) &&
    /^rpi_[a-f0-9]{24}$/u.test(event.repositoryInstanceId) &&
    ["git", "orca"].includes(event.hostKind) &&
    typeof event.hostVersion === "string" &&
    /^[a-f0-9]{40,64}$/u.test(event.baseCommit) &&
    /^sha256:[a-f0-9]{64}$/u.test(event.integrationTargetDigest) &&
    (event.previousState === "absent" || WORKSPACE_STATES.includes(event.previousState)) &&
    WORKSPACE_STATES.includes(event.state) &&
    (event.reasonCode === null || /^[a-z][a-z0-9_]{1,99}$/u.test(event.reasonCode)) &&
    (event.headCommit === null || /^[a-f0-9]{40,64}$/u.test(event.headCommit)) &&
    (event.treeHash === null || /^[a-f0-9]{40,64}$/u.test(event.treeHash)) &&
    (event.changedPathSetDigest === null ||
      /^sha256:[a-f0-9]{64}$/u.test(event.changedPathSetDigest)) &&
    (event.changedPathCount === null ||
      (Number.isSafeInteger(event.changedPathCount) && event.changedPathCount >= 0)) &&
    (event.integrationEvidenceId === null ||
      /^int_[a-f0-9]{24}$/u.test(event.integrationEvidenceId)) &&
    (event.cleanupPlanId === null || /^wcp_[a-f0-9]{24}$/u.test(event.cleanupPlanId)) &&
    Number.isSafeInteger(event.revision) &&
    event.revision >= 1
  );
}

export async function listWorkspaceCoordinationEvents(
  repositoryRoot: string,
): Promise<WorkspaceCoordinationEvent[]> {
  const records = await RepositoryCoordinationRecords.open(repositoryRoot);
  const values = (await records.list<unknown>("events")).map((record) => record.value);
  if (
    values.some(
      (value) =>
        value !== null &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        WORKSPACE_EVENT_TYPES.includes(
          (value as { type?: unknown }).type as WorkspaceCoordinationEvent["type"],
        ) &&
        !isWorkspaceCoordinationEvent(value),
    )
  )
    invalid("A stored workspace coordination event is invalid.");
  return values
    .filter(isWorkspaceCoordinationEvent)
    .map((event) => structuredClone(event))
    .sort(
      (left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
        left.workspaceId.localeCompare(right.workspaceId) ||
        left.revision - right.revision,
    );
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

export async function recordWorkspaceCheckpoint(input: {
  repositoryRoot: string;
  checkpoint: WorkspaceCheckpoint;
}): Promise<WorkspaceCheckpoint> {
  if (!isWorkspaceCheckpoint(input.checkpoint)) invalid("The workspace checkpoint is invalid.");
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const existing = await records.read<WorkspaceCheckpoint>("events", input.checkpoint.eventId);
  if (existing !== null) {
    if (
      !isWorkspaceCheckpoint(existing.value) ||
      stableJson(existing.value) !== stableJson(input.checkpoint)
    )
      throw new AgentWorkforceError(
        "workspace_transition_conflict",
        "The workspace checkpoint event ID was reused with different content.",
      );
    return structuredClone(existing.value);
  }
  const result = await records.write({
    collection: "events",
    recordId: input.checkpoint.eventId,
    value: input.checkpoint,
    expectedContentHash: null,
  });
  return structuredClone(result.value);
}
