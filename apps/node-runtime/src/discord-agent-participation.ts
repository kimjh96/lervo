import { listAgents, type WorkforceAgent } from "@lervo/agent-workforce";
import { resolveRoleContract, roleProfileHash } from "@lervo/roles";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import { NodeRuntimeError } from "./errors.js";

export interface DiscordAgentParticipation {
  agentId: string | null;
  roleId: string;
}

function acceptsProvider(agent: WorkforceAgent, provider: "codex" | "claude"): boolean {
  return agent.provider === "any" || agent.provider === provider;
}

async function activeAgent(repositoryRoot: string, agentId: string): Promise<WorkforceAgent> {
  const agent = (await listAgents(repositoryRoot)).find(
    (candidate) => candidate.agentId === agentId,
  );
  if (agent === undefined || agent.status !== "active") {
    throw new NodeRuntimeError(
      "invalid_config",
      "The Discord conversation agent must name an active hired agent.",
    );
  }
  const role = await resolveRoleContract(repositoryRoot, agent.roleId);
  if (
    role.version !== agent.roleVersion ||
    role.contractHash !== agent.roleContractHash ||
    roleProfileHash(role.definition.profile) !== agent.roleProfileHash
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "The Discord conversation agent role contract is stale.",
    );
  }
  return agent;
}

export async function resolveDiscordAgentParticipation(input: {
  repositoryRoot: string;
  config: NodeDiscordConversationConfig;
}): Promise<DiscordAgentParticipation> {
  const participantAgent =
    input.config.agentId === undefined
      ? null
      : await activeAgent(input.repositoryRoot, input.config.agentId);
  const participationProvider =
    input.config.routing?.response.provider ?? input.config.command.provider;
  if (participantAgent !== null && !acceptsProvider(participantAgent, participationProvider)) {
    throw new NodeRuntimeError(
      "invalid_config",
      "The hired conversation agent does not permit the configured response provider.",
    );
  }
  if (input.config.command.agentId !== null) {
    const commandAgent = await activeAgent(input.repositoryRoot, input.config.command.agentId);
    if (
      commandAgent.roleId !== input.config.command.roleId ||
      !acceptsProvider(commandAgent, input.config.command.provider)
    ) {
      throw new NodeRuntimeError(
        "invalid_config",
        "The managed command agent differs from its configured role or provider.",
      );
    }
  }
  return {
    agentId: participantAgent?.agentId ?? null,
    roleId: participantAgent?.roleId ?? input.config.command.roleId,
  };
}
