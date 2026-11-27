import { createHash } from "node:crypto";

import type { AgentWorkspace } from "./workspace-types.js";

const WORKSPACE_ID = /^wsp_[a-f0-9]{24}$/u;

/**
 * The record ID of one generation of a conversation's checkout (Lervo ADE coordination, "One
 * record per generation"). Every generation gets its own record, so a sealed generation can wait
 * for integration while the next one works; the ID derives from the conversation and the
 * generation alone, so any reader finds a generation's record without a lookup table.
 */
export function conversationWorkspaceRecordId(conversationId: string, generation: number): string {
  if (!WORKSPACE_ID.test(conversationId) || !Number.isSafeInteger(generation) || generation < 1)
    throw new TypeError("The conversation workspace coordinate is invalid.");
  const digest = createHash("sha256")
    .update(`lervo.conversation.workspace.v1\0${conversationId}\0${generation}`)
    .digest("hex");
  return `wsp_${digest.slice(0, 24)}`;
}

/** Whether the record is a conversation's generation; a record that names no kind is a worker's. */
export function isConversationWorkspace(workspace: AgentWorkspace): boolean {
  return workspace.kind === "conversation";
}

/**
 * Whether the record is a worker's: it names no kind, or `worker`. A reader that attaches worker
 * sessions asks this rather than excluding the kinds it knows, so a record of a kind a later
 * release adds is never taken for a worker's.
 */
export function isWorkerWorkspace(workspace: AgentWorkspace): boolean {
  const kind: unknown = workspace.kind;
  return kind === undefined || kind === "worker";
}

/** Whether a record's kind fields agree: a conversation record names its conversation exactly. */
export function validWorkspaceRecordKind(workspace: AgentWorkspace): boolean {
  if (workspace.kind === undefined || workspace.kind === "worker")
    return workspace.conversationId === undefined;
  return (
    workspace.kind === "conversation" &&
    typeof workspace.conversationId === "string" &&
    WORKSPACE_ID.test(workspace.conversationId) &&
    workspace.executionKind === "worker" &&
    workspace.workspaceId ===
      conversationWorkspaceRecordId(workspace.conversationId, workspace.generation)
  );
}

/** Newest first: the higher generation, then the later creation, then the ID for a stable order. */
function newestFirst(left: AgentWorkspace, right: AgentWorkspace): number {
  return (
    right.generation - left.generation ||
    Date.parse(right.createdAt) - Date.parse(left.createdAt) ||
    left.workspaceId.localeCompare(right.workspaceId)
  );
}

/**
 * The newest record of the checkout that is not `removed`, or null. A checkout may be named by
 * more than one path digest, such as that of its path as given and that of its real path. Root
 * resolution, workspace attachment, and cleanup read a checkout through this record, so an older
 * generation that waits for integration never speaks for the checkout while a newer one lives.
 */
export function newestCheckoutWorkspace(
  workspaces: readonly AgentWorkspace[],
  pathDigests: string | readonly string[],
): AgentWorkspace | null {
  const digests = new Set(typeof pathDigests === "string" ? [pathDigests] : pathDigests);
  return (
    workspaces
      .filter((workspace) => digests.has(workspace.pathDigest) && workspace.state !== "removed")
      .sort(newestFirst)[0] ?? null
  );
}

/** Whether a newer record that is not `removed` speaks for the same checkout. */
export function isSupersededCheckoutGeneration(
  workspace: AgentWorkspace,
  workspaces: readonly AgentWorkspace[],
): boolean {
  const newest = newestCheckoutWorkspace(workspaces, workspace.pathDigest);
  return newest !== null && newest.workspaceId !== workspace.workspaceId;
}

/** Every generation of one conversation, oldest first, `removed` ones included. */
export function conversationWorkspaceGenerations(
  workspaces: readonly AgentWorkspace[],
  conversationId: string,
): AgentWorkspace[] {
  return workspaces
    .filter(
      (workspace) =>
        isConversationWorkspace(workspace) && workspace.conversationId === conversationId,
    )
    .sort((left, right) => newestFirst(right, left));
}

/** The conversation's newest generation that is not `removed`, or null. */
export function newestConversationWorkspace(
  workspaces: readonly AgentWorkspace[],
  conversationId: string,
): AgentWorkspace | null {
  return (
    conversationWorkspaceGenerations(workspaces, conversationId)
      .filter((workspace) => workspace.state !== "removed")
      .at(-1) ?? null
  );
}
