import { RepositoryCoordinationRecords } from "@lervo/project-storage";

import {
  isWorkspaceIntegrationQueueEntry,
  orderWorkspaceIntegrations,
} from "./workspace-lifecycle.js";
import { AgentWorkforceError } from "./types.js";
import { readWorkspace } from "./workspace-store.js";
import type {
  WorkspaceIntegrationCandidate,
  WorkspaceIntegrationQueueEntry,
} from "./workspace-types.js";

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

function invalid(message: string): never {
  throw new AgentWorkforceError("workspace_invalid", message);
}

export async function enqueueWorkspaceIntegration(input: {
  repositoryRoot: string;
  entry: WorkspaceIntegrationQueueEntry;
}): Promise<WorkspaceIntegrationQueueEntry> {
  if (!isWorkspaceIntegrationQueueEntry(input.entry))
    invalid("The integration queue entry is invalid.");
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const existing = await records.read<WorkspaceIntegrationQueueEntry>(
    "integrations",
    input.entry.queueEntryId,
  );
  if (existing !== null) {
    if (
      !isWorkspaceIntegrationQueueEntry(existing.value) ||
      stableJson(existing.value) !== stableJson(input.entry)
    )
      throw new AgentWorkforceError(
        "workspace_transition_conflict",
        "The integration queue entry ID was reused with different content.",
      );
    return structuredClone(existing.value);
  }
  const stored = await records.write({
    collection: "integrations",
    recordId: input.entry.queueEntryId,
    value: input.entry,
    expectedContentHash: null,
  });
  return structuredClone(stored.value);
}

export async function listWorkspaceIntegrationQueue(input: {
  repositoryRoot: string;
  completedAssignmentIds?: string[];
}): Promise<WorkspaceIntegrationQueueEntry[]> {
  const records = await RepositoryCoordinationRecords.open(input.repositoryRoot);
  const stored = await records.list<WorkspaceIntegrationQueueEntry>("integrations");
  if (stored.some((record) => !isWorkspaceIntegrationQueueEntry(record.value)))
    invalid("A stored integration queue entry is invalid.");
  const entries = (
    await Promise.all(
      stored.map(async (record) => {
        const workspace = await readWorkspace(input.repositoryRoot, record.value.workspaceId);
        return workspace?.workspace.state === "integration_pending" &&
          workspace.workspace.generation === record.value.generation &&
          workspace.workspace.integrationQueueEntryId === record.value.queueEntryId
          ? record.value
          : null;
      }),
    )
  ).filter((entry): entry is WorkspaceIntegrationQueueEntry => entry !== null);
  const candidates: WorkspaceIntegrationCandidate[] = entries.map((entry) => ({
    workspaceId: entry.workspaceId,
    generation: entry.generation,
    assignmentId: entry.assignmentId,
    dependencyAssignmentIds: entry.dependencyAssignmentIds,
    priority: entry.priority,
    sealedAt: entry.sealedAt,
  }));
  const order = orderWorkspaceIntegrations(candidates, input.completedAssignmentIds);
  const byWorkspace = new Map(entries.map((entry) => [entry.workspaceId, entry]));
  return order.map((candidate) => structuredClone(byWorkspace.get(candidate.workspaceId)!));
}
