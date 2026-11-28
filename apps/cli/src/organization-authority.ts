// Who may change a project's organization (ADR-0662): the owner always, and a hired agent only as
// far as its role's request types reach (ADR-0639: a role's request types are its authority).
import { listAgents } from "@lervo/agent-workforce";
import { grantsRequestType, resolveRoleContract } from "@lervo/roles";

import { CommandFailure } from "./command-error-output.js";

/**
 * The hired agent a command runs for: the agent whose hosted session runs it, named by the
 * session's `LERVO_AGENT_ID` (Lervo ADE agents, "Participants and sessions"). Undefined is the
 * owner, in their own terminal or through the ADE. Like `agent_not_caller`, this attributes a
 * command; it is no sandbox against a session that edits its own environment.
 */
export function commandActor(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const agentId = environment.LERVO_AGENT_ID;
  return agentId === undefined || agentId.length === 0 ? undefined : agentId;
}

/**
 * Refuses an organization change by an agent whose role lacks `requestType`, with
 * `agent_not_authorized`. The owner, `actorAgentId` undefined, is never refused.
 */
export async function assertOrganizationAuthority(
  root: string,
  actorAgentId: string | undefined,
  requestType: string,
): Promise<void> {
  if (actorAgentId === undefined) return;
  const agent = (await listAgents(root, { readOnly: true })).find(
    (candidate) => candidate.agentId === actorAgentId,
  );
  if (agent === undefined || agent.status !== "active")
    throw new CommandFailure(
      "agent_not_authorized",
      `Agent ${actorAgentId} is not an active agent of this project.`,
    );
  const contract = await resolveRoleContract(root, agent.roleId);
  if (!grantsRequestType(contract, requestType))
    throw new CommandFailure(
      "agent_not_authorized",
      `${agent.displayName}'s role ${contract.roleId} does not carry ${requestType}; ask the owner or an agent whose role does.`,
      { agentId: agent.agentId, roleId: contract.roleId, requestType },
    );
}
