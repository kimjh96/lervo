import {
  deliberationExecutionRouteHash,
  workforceProviderForPolicyHash,
  type DeliberationParticipantBinding,
} from "@lervo/agent-organization";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import {
  allowedRoute,
  nodeRoleRoute,
  nodeRouteForProvider,
  optionalRouteFields,
  type ReadNodeModelSelection,
} from "./node-model-route.js";

type Provider = "codex" | "claude";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface DeliberationParticipantExecutionRoute {
  provider: Provider;
  model: string | null;
  reasoningEffort: Effort | null;
  executionRouteHash: string;
}

/**
 * ADR-0612 M2c: a deliberation seat's route. Participants reason, so the `reasoning` role of the
 * model selection decides inside the hired agent's provider policy.
 *
 * - A seat the selection routes binds only its provider: its route hash covers the provider with
 *   no model or effort, and each start or resume takes the role's current model and effort for
 *   that provider. A selection change during a deliberation therefore never breaks its resume.
 * - A seat the Node configuration routes keeps today's hash over provider, model, and effort, so
 *   a deliberation accepted before this release resumes unchanged.
 */
export function deliberationParticipantRoute(input: {
  route: NonNullable<NodeDiscordConversationConfig["deliberationParticipation"]>["routes"][number];
  endpoint: NodeDiscordConversationConfig;
  existing:
    Pick<DeliberationParticipantBinding, "executionRouteHash" | "executionProvider"> | undefined;
  providerPolicyHash: string;
  readSelection?: ReadNodeModelSelection;
}): DeliberationParticipantExecutionRoute {
  const response = input.endpoint.routing?.response;
  const configured = {
    provider: input.route.provider ?? response?.provider ?? input.endpoint.command.provider,
    model: input.route.model ?? response?.model,
    reasoningEffort: input.route.reasoningEffort ?? response?.reasoningEffort,
  };
  const hash = (provider: Provider, model: string | null, reasoningEffort: Effort | null) =>
    deliberationExecutionRouteHash({
      participantId: input.endpoint.agentParticipantId,
      integrationId: input.endpoint.integrationId,
      provider,
      model,
      reasoningEffort,
    });
  const selection = input.readSelection === undefined ? {} : { readSelection: input.readSelection };
  const providerBound = (provider: Provider) => {
    const routed = nodeRouteForProvider({
      role: "reasoning",
      provider,
      configured: provider === configured.provider ? configured : {},
      ...selection,
    });
    return {
      provider,
      model: routed.model ?? null,
      reasoningEffort: routed.reasoningEffort ?? null,
      executionRouteHash: hash(provider, null, null),
    };
  };
  const existingProvider = input.existing?.executionProvider;
  if (
    existingProvider !== undefined &&
    input.existing!.executionRouteHash === hash(existingProvider, null, null)
  )
    return providerBound(existingProvider);
  if (input.existing === undefined) {
    const policy = workforceProviderForPolicyHash(input.providerPolicyHash);
    const chosen = nodeRoleRoute({
      role: "reasoning",
      configured: { provider: configured.provider, ...optionalRouteFields(configured) },
      ...allowedRoute(policy),
      ...selection,
    });
    if (chosen.source === "selection") return providerBound(chosen.provider);
  }
  const model = configured.model ?? null;
  const reasoningEffort = configured.reasoningEffort ?? null;
  return {
    provider: configured.provider,
    model,
    reasoningEffort,
    executionRouteHash: hash(configured.provider, model, reasoningEffort),
  };
}
