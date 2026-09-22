import type { NodeDiscordConversationConfig, NodeRuntimeConfig } from "./config-types.js";
import type { DiscordAgentParticipation } from "./discord-agent-participation.js";
import { NodeRuntimeError } from "./errors.js";

/**
 * A deployed repository product owner is the durable goal owner, not an ordinary chat-only role.
 * Requiring one exact installed binding here prevents owner-only configuration drift from silently
 * downgrading a product owner to single-turn repository work.
 */
export function assertProductOwnerSupervisionPolicy(input: {
  config: NodeRuntimeConfig;
  deployments: readonly NodeDiscordConversationConfig[];
  participations: readonly DiscordAgentParticipation[];
}): void {
  if (input.deployments.length !== input.participations.length) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Product-owner supervision policy requires every deployment participation.",
    );
  }
  const productOwners = input.deployments.flatMap((deployment, index) => {
    const participation = input.participations[index]!;
    return participation.roleId === "product-owner" ? [{ deployment, participation }] : [];
  });
  if (productOwners.length === 0) return;
  if (productOwners.length !== 1) {
    throw new NodeRuntimeError(
      "invalid_config",
      "A repository Node requires exactly one deployed product owner for supervision.",
    );
  }
  const { deployment, participation } = productOwners[0]!;
  if (
    participation.agentId === null ||
    deployment.agentId !== participation.agentId ||
    deployment.policy?.acceptsSupervisionGoals !== true ||
    input.config.outcomeSupervision === undefined ||
    input.config.outcomeSupervision.binding.ownerAgentId !== participation.agentId
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "A deployed product owner requires its exact installed supervision binding and goal intake.",
    );
  }
}
