import type { WorkforceAgent } from "@lervo/agent-workforce";

import { projectOrganization } from "./agent-organization-event-mutation.js";
import { mutateAgentOrganization } from "./agent-organization-mutation.js";
import type { NodeDiscordConversationConfig } from "./config-types.js";
import {
  bindDiscordAgentDeployment,
  deactivateDiscordAgentDeployment,
} from "./discord-agent-organization-deployment-binding.js";

export interface DiscordAgentOrganizationDeploymentPort {
  bind(input: { config: NodeDiscordConversationConfig; agent: WorkforceAgent }): Promise<void>;
  deactivate?(input: { agent: WorkforceAgent }): Promise<void>;
}

export class RepositoryDiscordAgentOrganizationDeployment implements DiscordAgentOrganizationDeploymentPort {
  constructor(private readonly repositoryRoot: string) {}

  async bind(input: { config: NodeDiscordConversationConfig; agent: WorkforceAgent }) {
    const organization = input.config.organization;
    if (organization === undefined) return;
    await mutateAgentOrganization(this.repositoryRoot, async (storage) => {
      const team = projectOrganization(storage).team;
      if (
        team === null ||
        team.organizationId !== organization.organizationId ||
        team.teamId !== organization.teamId
      ) {
        throw new Error("The hired agent deployment requires the exact bound organization team.");
      }
      bindDiscordAgentDeployment({
        storage,
        ...organization,
        config: input.config,
        agent: input.agent,
        occurredAt: new Date().toISOString(),
      });
    });
  }

  async deactivate(input: { agent: WorkforceAgent }) {
    await mutateAgentOrganization(this.repositoryRoot, async (storage) => {
      deactivateDiscordAgentDeployment({
        storage,
        agent: input.agent,
        occurredAt: new Date().toISOString(),
      });
    });
  }
}
