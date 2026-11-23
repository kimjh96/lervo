import {
  deliberationExecutionRouteHash,
  selectionRoutedDeliberationRouteHash,
  type DeliberationParticipantBinding,
} from "@lervo/agent-organization";

import { DEFAULT_ROLE_REASONING_EFFORT } from "@lervo/execution-contract";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import { readHostNodeModelSelection, type ReadNodeModelSelection } from "./node-model-route.js";

type Provider = "codex" | "claude";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface DeliberationParticipantExecutionRoute {
  provider: Provider;
  model: string | null;
  reasoningEffort: Effort | null;
  executionRouteHash: string;
}

/**
 * ADR-0612 M2c: a deliberation seat's route. The seat's provider is the configured one, because
 * the reviewed deliberation policy fixes a provider per seat. Participants reason, so the
 * `reasoning` role chooses the model and effort for that provider.
 *
 * - When the role lists the seat's provider at acceptance, the seat binds only its provider, with
 *   the selection marker in its route hash. Each start or resume then takes the role's current
 *   model and effort for it, so a model change never breaks a resume.
 * - Otherwise the seat keeps today's hash over the configured provider, model, and effort, so a
 *   seat accepted before this release, or while the role is unset, resumes unchanged.
 */
export function deliberationParticipantRoute(input: {
  route: NonNullable<NodeDiscordConversationConfig["deliberationParticipation"]>["routes"][number];
  endpoint: NodeDiscordConversationConfig;
  existing: Pick<DeliberationParticipantBinding, "executionRouteHash"> | undefined;
  readSelection?: ReadNodeModelSelection;
}): DeliberationParticipantExecutionRoute {
  const response = input.endpoint.routing?.response;
  const provider = input.route.provider ?? response?.provider ?? input.endpoint.command.provider;
  const model = input.route.model ?? response?.model ?? null;
  const reasoningEffort = input.route.reasoningEffort ?? response?.reasoningEffort ?? null;
  const coordinates = {
    participantId: input.endpoint.agentParticipantId,
    integrationId: input.endpoint.integrationId,
    provider,
  };
  const markerHash = selectionRoutedDeliberationRouteHash(coordinates);
  const listed = (input.readSelection ?? readHostNodeModelSelection)().roles.reasoning?.find(
    (candidate) => candidate.provider === provider,
  );
  const selectionRouted =
    input.existing === undefined
      ? listed !== undefined
      : input.existing.executionRouteHash === markerHash;
  if (!selectionRouted)
    return {
      provider,
      model,
      reasoningEffort,
      executionRouteHash: deliberationExecutionRouteHash({
        ...coordinates,
        model,
        reasoningEffort,
      }),
    };
  // A route without a model keeps the seat's configured model, which the deliberation runner
  // would otherwise fall back to, so the assignment names the model that runs.
  return {
    provider,
    model: listed?.model ?? model,
    reasoningEffort:
      listed === undefined
        ? reasoningEffort
        : (listed.reasoningEffort ?? DEFAULT_ROLE_REASONING_EFFORT.reasoning),
    executionRouteHash: markerHash,
  };
}
