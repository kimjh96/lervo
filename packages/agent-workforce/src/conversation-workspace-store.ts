import { randomUUID } from "node:crypto";

import {
  conversationWorkspaceGenerations,
  conversationWorkspaceRecordId,
  newestCheckoutWorkspace,
  newestConversationWorkspace,
} from "./conversation-workspace.js";
import { AgentWorkforceError } from "./types.js";
import {
  createWorkspace,
  listWorkspaces,
  readWorkspace,
  updateWorkspace,
} from "./workspace-store.js";
import type { AgentWorkspace } from "./workspace-types.js";

/** The newest record of the checkout named by `pathDigests` that is not `removed`, or null. */
export async function readNewestCheckoutWorkspace(
  repositoryRoot: string,
  pathDigests: string | readonly string[],
): Promise<AgentWorkspace | null> {
  return newestCheckoutWorkspace(await listWorkspaces(repositoryRoot), pathDigests);
}

/** The conversation's newest generation that is not `removed`, or null. */
export async function readNewestConversationWorkspace(
  repositoryRoot: string,
  conversationId: string,
): Promise<AgentWorkspace | null> {
  return newestConversationWorkspace(await listWorkspaces(repositoryRoot), conversationId);
}

/** Every generation of one conversation, oldest first, `removed` ones included. */
export async function listConversationWorkspaceGenerations(
  repositoryRoot: string,
  conversationId: string,
): Promise<AgentWorkspace[]> {
  return conversationWorkspaceGenerations(await listWorkspaces(repositoryRoot), conversationId);
}

/** One generation of a conversation's checkout, bound to its assignment's lease and its marker. */
export interface ConversationWorkspaceGenerationInput {
  repositoryRoot: string;
  conversationId: string;
  generation: number;
  repositoryInstanceId: string;
  projectId: string;
  assignmentId: string;
  agentId: string;
  leaseGeneration: number;
  host: AgentWorkspace["host"];
  /** The branch head the generation's change is measured from. */
  baseCommit: string;
  integrationTargetDigest: string;
  creationPlanId: string;
  markerHash: string;
  pathDigest: string;
  ownerWorkspacePath: string;
  /** What the host proved of the checkout just before the record moves to `ready`. */
  inspection: { hostInspected: boolean; markerMatched: boolean; checkoutClean: boolean };
  now: Date;
}

function conflict(message: string): never {
  throw new AgentWorkforceError("workspace_transition_conflict", message);
}

/**
 * Records a conversation's workspace generation in `provisioning`, then moves it to `ready` on
 * the host's proof of the marker and a clean checkout. The checkout's newest live record, when
 * there is one, must be an earlier generation of the same conversation: one checkout never speaks
 * for two conversations. Each step records its existing `agent.workspace.*` event.
 */
export async function recordConversationWorkspaceGeneration(
  input: ConversationWorkspaceGenerationInput,
): Promise<{ workspace: AgentWorkspace; contentHash: string }> {
  const workspaceId = conversationWorkspaceRecordId(input.conversationId, input.generation);
  const current = await readNewestCheckoutWorkspace(input.repositoryRoot, input.pathDigest);
  if (
    current !== null &&
    (current.conversationId !== input.conversationId || current.generation >= input.generation)
  )
    conflict("Another workspace record already speaks for this checkout.");
  const occurredAt = input.now.toISOString();
  const provisioning: AgentWorkspace = {
    schemaVersion: 1,
    workspaceId,
    generation: input.generation,
    repositoryInstanceId: input.repositoryInstanceId,
    projectId: input.projectId,
    assignmentId: input.assignmentId,
    agentId: input.agentId,
    leaseGeneration: input.leaseGeneration,
    executionKind: "worker",
    kind: "conversation",
    conversationId: input.conversationId,
    host: input.host,
    baseCommit: input.baseCommit,
    integrationTargetDigest: input.integrationTargetDigest,
    creationPlanId: input.creationPlanId,
    markerHash: input.markerHash,
    pathDigest: input.pathDigest,
    ownerWorkspacePath: input.ownerWorkspacePath,
    state: "provisioning",
    writerSession: null,
    sealedResult: null,
    integrationQueueEntryId: null,
    integrationEvidenceId: null,
    cleanupPlanId: null,
    recoveryReason: null,
    revision: 1,
    createdAt: occurredAt,
    updatedAt: occurredAt,
  };
  const created = await createWorkspace({
    repositoryRoot: input.repositoryRoot,
    workspace: provisioning,
    eventId: eventId(),
  });
  const stored = await readWorkspace(input.repositoryRoot, created.workspaceId);
  if (stored === null) conflict("The new workspace record disappeared before it was ready.");
  return updateWorkspace({
    repositoryRoot: input.repositoryRoot,
    workspaceId: created.workspaceId,
    expectedContentHash: stored.contentHash,
    expectedRevision: created.revision,
    expectedGeneration: created.generation,
    nextState: "ready",
    occurredAt,
    evidence: input.inspection,
    eventId: eventId(),
  });
}

function eventId(): string {
  return `evt_${randomUUID().replaceAll("-", "")}`;
}
