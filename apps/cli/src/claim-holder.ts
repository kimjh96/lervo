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

/** The longest name or title a refusal carries into the agent's message. */
const MAXIMUM_LABEL_CHARACTERS = 80;

/** `value` on one line without control characters, at most 80 characters. */
function label(value: string): string {
  const line = value
    .replace(/[\p{Cc}\p{Cf}\u2028\u2029]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  return line.length <= MAXIMUM_LABEL_CHARACTERS
    ? line
    : `${line.slice(0, MAXIMUM_LABEL_CHARACTERS - 1).trimEnd()}…`;
}

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
  if (newest?.ownerWorkspacePath === undefined) return null;
  const title = await workstreamTitle(newest.ownerWorkspacePath);
  return title === null || label(title) === "" ? null : label(title);
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
    listAgents(input.repositoryRoot, { readOnly: true }).catch(() => null),
    roleCatalog(input.repositoryRoot).catch(() => ({ names: new Map<string, string>() })),
    conversationTitle(input.workspaces, refusal.holderWorkspaceId),
    kind === "lease" ? leaseExpiry(input.repositoryRoot, refusal.holderAssignmentId) : null,
  ]);
  const agent = agents?.find((item) => item.agentId === refusal.holderAgentId);
  return {
    agentId: refusal.holderAgentId,
    displayName: agent === undefined ? refusal.holderAgentId : label(agent.displayName),
    roleName: agent === undefined ? "" : label(roles.names.get(agent.roleId) ?? agent.roleId),
    origin: agent === undefined ? "unknown" : agent.origin === "lervo" ? "lervo" : "team",
    workspaceId: refusal.holderWorkspaceId,
    conversationTitle: title,
    kind,
    until,
  };
}
