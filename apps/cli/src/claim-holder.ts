// Who holds a refused path, as the refusal's message and the claim log name it (Lervo ADE
// coordination, "The claim contract"): the agent, its role, and the conversation it works in.
import {
  listAgents,
  newestConversationWorkspace,
  readAssignment,
  type AgentWorkspace,
  type AssignmentPathRefusal,
} from "@lervo/agent-workforce";

import { roleCatalog } from "./role-catalog.js";
import type { ClaimHolder } from "./claim-contract.js";
import { workstreamTitle } from "./workstream-title.js";

const HOLDER_KINDS: Readonly<Record<string, ClaimHolder["kind"]>> = {
  path_leased: "lease",
  path_changed_unsealed: "changed",
  path_awaiting_integration: "sealed_change",
};

/** The title of a conversation: its newest generation's worktree's workstream title. */
async function conversationTitle(
  workspaces: readonly AgentWorkspace[],
  conversationId: string | null,
): Promise<string | null> {
  if (conversationId === null) return null;
  const newest = newestConversationWorkspace(workspaces, conversationId);
  return newest?.ownerWorkspacePath === undefined
    ? null
    : workstreamTitle(newest.ownerWorkspacePath);
}

/** When a live lease frees the path, or null when no timer does or the lease is unreadable. */
async function leaseExpiry(repositoryRoot: string, assignmentId: string | null) {
  if (assignmentId === null) return null;
  const assignment = await readAssignment(repositoryRoot, assignmentId).catch(() => null);
  return assignment?.lease?.expiresAt ?? null;
}

/**
 * The holder a refusal names, or null for a refusal without one, such as a path outside the
 * lead's responsibility. A holder whose agent record is gone keeps its agent ID as its name.
 */
export async function resolveClaimHolder(input: {
  readonly repositoryRoot: string;
  readonly refusal: AssignmentPathRefusal;
  readonly workspaces: readonly AgentWorkspace[];
}): Promise<ClaimHolder | null> {
  const { refusal } = input;
  const kind = HOLDER_KINDS[refusal.code];
  if (kind === undefined || refusal.holderAgentId === null) return null;
  const [agents, roles, title, until] = await Promise.all([
    listAgents(input.repositoryRoot, { readOnly: true }).catch(() => []),
    roleCatalog(input.repositoryRoot).catch(() => ({ names: new Map<string, string>() })),
    conversationTitle(input.workspaces, refusal.holderWorkspaceId),
    kind === "lease" ? leaseExpiry(input.repositoryRoot, refusal.holderAssignmentId) : null,
  ]);
  const agent = agents.find((item) => item.agentId === refusal.holderAgentId);
  return {
    agentId: refusal.holderAgentId,
    displayName: agent?.displayName ?? refusal.holderAgentId,
    roleName: agent === undefined ? "" : (roles.names.get(agent.roleId) ?? agent.roleId),
    origin: agent?.origin === "lervo" ? "lervo" : "team",
    workspaceId: refusal.holderWorkspaceId,
    conversationTitle: title,
    kind,
    until,
  };
}
