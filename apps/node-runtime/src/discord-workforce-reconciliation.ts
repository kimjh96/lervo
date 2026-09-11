import { DiscordRestAdministration, type DiscordAdministrationPort } from "@lervo/adapter-discord";
import { listAgents, type WorkforceAgent } from "@lervo/agent-workforce";

import { loadNodeRuntimeConfig } from "./config.js";
import {
  configuredDiscordConversations,
  MAX_DISCORD_CONVERSATIONS,
} from "./discord-conversation-deployments-config.js";
import { loadDiscordBotToken } from "./discord-credentials.js";
import { DiscordHiredAgentDeployment } from "./discord-hired-agent-deployment.js";
import { NodeRuntimeError } from "./errors.js";
import { RepositoryDiscordAgentOrganizationDeployment } from "./discord-agent-organization-deployment.js";

export interface DiscordWorkforceReconciliationResult {
  parentAgentId: string;
  conversationId: string;
  agentIds: string[];
  createdAgentIds: string[];
  deactivatedAgentIds: string[];
}

function directActiveChildren(agents: readonly WorkforceAgent[], parentAgentId: string) {
  return agents.filter(
    (agent) => agent.parentAgentId === parentAgentId && agent.status === "active",
  );
}

export async function reconcileDiscordWorkforce(input: {
  repositoryRoot: string;
  configPath: string;
  parentIntegrationId: string;
  conversationId: string;
  administration?: Pick<
    DiscordAdministrationPort,
    "createIncomingWebhook" | "updateIncomingWebhook" | "deleteIncomingWebhook"
  >;
  fetch?: typeof globalThis.fetch;
}): Promise<DiscordWorkforceReconciliationResult> {
  const config = await loadNodeRuntimeConfig(input.configPath);
  const deployments = configuredDiscordConversations(config);
  const parent = deployments.find(
    (candidate) => candidate.integrationId === input.parentIntegrationId,
  );
  if (
    parent === undefined ||
    parent.agentId === undefined ||
    parent.administration?.allowedActions.includes("workforce.agent.hire") !== true ||
    parent.administration.allowedActions.includes("incoming_webhook.create") !== true ||
    parent.administration.webhookCredentialDirectory === undefined
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord workforce reconciliation requires an installed product-owner deployment.",
    );
  }
  if (!parent.conversations.some((item) => item.conversationId === input.conversationId)) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord workforce reconciliation requires an allowlisted parent conversation.",
    );
  }
  const agents = await listAgents(input.repositoryRoot);
  const parentAgent = agents.find((agent) => agent.agentId === parent.agentId);
  if (parentAgent?.status !== "active" || parentAgent.roleId !== "product-owner") {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord workforce reconciliation requires the active product-owner agent.",
    );
  }
  const children = directActiveChildren(agents, parent.agentId);
  const retiredChildren = agents.filter(
    (agent) => agent.parentAgentId === parent.agentId && agent.status === "retired",
  );
  const retiredChildIds = new Set(retiredChildren.map((agent) => agent.agentId));
  const configuredAgentIds = new Set(deployments.flatMap((item) => item.agentId ?? []));
  const missing = children.filter((agent) => !configuredAgentIds.has(agent.agentId));
  const removableDeploymentCount = deployments.filter(
    (item) => item.agentId !== undefined && retiredChildIds.has(item.agentId),
  ).length;
  if (deployments.length - removableDeploymentCount + missing.length > MAX_DISCORD_CONVERSATIONS) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Discord workforce reconciliation exceeds the deployment capacity before external effects begin.",
    );
  }
  const administration =
    input.administration ??
    new DiscordRestAdministration({
      applicationId: parent.applicationId,
      botToken: await loadDiscordBotToken(parent.botTokenFile),
      allowedGuildIds: parent.allowedGuildIds,
      allowedChannelIds: parent.conversations.map((item) => item.conversationKey),
      ...(parent.http?.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: parent.http.requestTimeoutMs }),
      ...(parent.http?.maxResponseBytes === undefined
        ? {}
        : { maxResponseBytes: parent.http.maxResponseBytes }),
      ...(input.fetch === undefined ? {} : { fetch: input.fetch }),
    });
  const deployment = new DiscordHiredAgentDeployment({
    configPath: input.configPath,
    parentIntegrationId: input.parentIntegrationId,
    administration,
    organization: new RepositoryDiscordAgentOrganizationDeployment(input.repositoryRoot),
  });
  const deactivatedAgentIds: string[] = [];
  for (const child of retiredChildren) {
    const result = await deployment.deactivate({ agent: child });
    if (result.configurationChanged) deactivatedAgentIds.push(child.agentId);
  }
  const createdAgentIds: string[] = [];
  for (const child of children) {
    const result = await deployment.prepare({
      agent: child,
      conversationId: input.conversationId,
    });
    if (result.configurationChanged) createdAgentIds.push(child.agentId);
  }
  return {
    parentAgentId: parent.agentId,
    conversationId: input.conversationId,
    agentIds: children.map((agent) => agent.agentId),
    createdAgentIds,
    deactivatedAgentIds,
  };
}
