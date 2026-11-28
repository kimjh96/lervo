// Moving a hired agent to another role (ADR-0662), as `lervo agent role` and the core link's
// `agent.role` do. ADR-0386 keeps the agent suspended during the transition; this sequences the
// pause around it so the owner never has to.
import {
  changeAgentRole,
  changeAgentStatus,
  listAgents,
  type WorkforceAgent,
} from "@lervo/agent-workforce";
import { ORGANIZATION_REQUEST_TYPE } from "@lervo/roles";

import { CommandFailure } from "./command-error-output.js";
import { assertOrganizationAuthority } from "./organization-authority.js";
import { mutateWorkforceState } from "./workforce-mutation.js";

/**
 * Moves the agent at `expectedRevision` to `roleId`, keeping its ID, name, and context (ADR-0386).
 * An active agent is paused for the move and works again after it, each step its own recorded
 * transition; a move that fails puts the agent back to work at its old role. An agent whose role
 * lacks `organization.coordinate` fails with `agent_not_authorized`.
 */
export async function moveAgentToRole(
  root: string,
  move: { agentId: string; roleId: string; expectedRevision: number },
  actorAgentId: string | undefined,
): Promise<WorkforceAgent> {
  await assertOrganizationAuthority(root, actorAgentId, ORGANIZATION_REQUEST_TYPE);
  const agent = (await listAgents(root, { readOnly: true })).find(
    (candidate) => candidate.agentId === move.agentId,
  );
  if (agent === undefined) throw new CommandFailure("agent_not_found", "The agent does not exist.");
  const actor = actorAgentId === undefined ? {} : { actorAgentId };
  return mutateWorkforceState(root, async (recordEvent) => {
    const change = { repositoryRoot: root, agentId: move.agentId, recordEvent, ...actor };
    if (agent.status !== "active")
      return changeAgentRole({
        ...change,
        roleId: move.roleId,
        expectedRevision: move.expectedRevision,
      });
    const paused = await changeAgentStatus({
      ...change,
      status: "suspended",
      expectedRevision: move.expectedRevision,
    });
    let moved: WorkforceAgent;
    try {
      moved = await changeAgentRole({
        ...change,
        roleId: move.roleId,
        expectedRevision: paused.revision,
      });
    } catch (error) {
      await changeAgentStatus({ ...change, status: "active", expectedRevision: paused.revision });
      throw error;
    }
    return changeAgentStatus({ ...change, status: "active", expectedRevision: moved.revision });
  });
}
