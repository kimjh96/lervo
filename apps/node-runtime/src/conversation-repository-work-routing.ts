import type {
  RepositoryWorkProvider,
  RepositoryWorkReasoningEffort,
} from "@lervo/adapter-contract";

import type {
  NodeRepositoryWorkExecutionProfile,
  NodeRepositoryWorkExecutionProfilePolicy,
} from "./config-types.js";

export type ConversationRepositoryWorkAllocationReason =
  "session_continuity" | "bound_agent_provider" | "profile_preference" | "configured_default";

export interface ConversationRepositoryWorkRoute {
  provider: RepositoryWorkProvider;
  model: string | null;
  reasoningEffort: RepositoryWorkReasoningEffort | null;
  executionProfile: NodeRepositoryWorkExecutionProfile | null;
  allocationReason: ConversationRepositoryWorkAllocationReason;
}

/** Selects the requested work profile while replaying each event on its original provider. */
export function selectConversationRepositoryWorkRoute(input: {
  replayProvider?: RepositoryWorkProvider | null;
  sessionProvider: RepositoryWorkProvider | null;
  boundProvider: RepositoryWorkProvider | "any" | null;
  defaultProvider: RepositoryWorkProvider;
  executionProfile: NodeRepositoryWorkExecutionProfile | null;
  executionProfiles?: Record<
    NodeRepositoryWorkExecutionProfile,
    NodeRepositoryWorkExecutionProfilePolicy
  >;
  models?: Partial<Record<RepositoryWorkProvider, string>>;
  reasoningEfforts?: Partial<Record<RepositoryWorkProvider, RepositoryWorkReasoningEffort>>;
}): ConversationRepositoryWorkRoute {
  const profilePolicy =
    input.executionProfile === null ? undefined : input.executionProfiles?.[input.executionProfile];
  const [provider, allocationReason] =
    input.replayProvider !== null && input.replayProvider !== undefined
      ? [input.replayProvider, "session_continuity" as const]
      : input.boundProvider !== null && input.boundProvider !== "any"
        ? [input.boundProvider, "bound_agent_provider" as const]
        : profilePolicy !== undefined
          ? [profilePolicy.preferredProvider, "profile_preference" as const]
          : input.sessionProvider !== null
            ? [input.sessionProvider, "session_continuity" as const]
            : [input.defaultProvider, "configured_default" as const];
  const route = profilePolicy?.providers[provider];
  if (profilePolicy !== undefined && route === undefined) {
    throw new Error(
      `The ${input.executionProfile} execution profile has no route for the retained ${provider} provider.`,
    );
  }
  return {
    provider,
    model:
      route?.model ?? (profilePolicy === undefined ? input.models?.[provider] : undefined) ?? null,
    reasoningEffort:
      route?.reasoningEffort ??
      (profilePolicy === undefined ? input.reasoningEfforts?.[provider] : undefined) ??
      null,
    executionProfile: input.executionProfile,
    allocationReason,
  };
}
