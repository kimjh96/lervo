import type {
  RepositoryWorkProvider,
  RepositoryWorkReasoningEffort,
} from "@lervo/adapter-contract";

import type {
  NodeRepositoryWorkExecutionProfile,
  NodeRepositoryWorkExecutionProfilePolicy,
} from "./config-types.js";
import {
  allowedRoute,
  nodeRoleRoute,
  nodeRouteForProvider,
  optionalRouteFields,
  readHostNodeModelSelection,
  type ProviderStartable,
  type ReadNodeModelSelection,
} from "./node-model-route.js";

export type ConversationRepositoryWorkAllocationReason =
  "session_continuity" | "bound_agent_provider" | "profile_preference" | "configured_default";

export interface ConversationRepositoryWorkRoute {
  provider: RepositoryWorkProvider;
  model: string | null;
  reasoningEffort: RepositoryWorkReasoningEffort | null;
  executionProfile: NodeRepositoryWorkExecutionProfile | null;
  allocationReason: ConversationRepositoryWorkAllocationReason;
}

/** A responder's configured routes and executors, as `selectConversationRepositoryWorkRoute` takes them. */
export function configuredWorkRoutes(options: {
  executionProfiles?: Record<
    NodeRepositoryWorkExecutionProfile,
    NodeRepositoryWorkExecutionProfilePolicy
  >;
  models?: Partial<Record<RepositoryWorkProvider, string>>;
  reasoningEfforts?: Partial<Record<RepositoryWorkProvider, RepositoryWorkReasoningEffort>>;
  executors: Partial<Record<RepositoryWorkProvider, unknown>>;
}) {
  return {
    ...(options.executionProfiles === undefined
      ? {}
      : { executionProfiles: options.executionProfiles }),
    ...(options.models === undefined ? {} : { models: options.models }),
    ...(options.reasoningEfforts === undefined
      ? {}
      : { reasoningEfforts: options.reasoningEfforts }),
    executors: options.executors,
  };
}

/** The providers a selected route may use: the bound agent's policy and this Node's executors. */
function workAllowed(
  bound: RepositoryWorkProvider | "any" | null,
  executors: Partial<Record<RepositoryWorkProvider, unknown>> | undefined,
): { allowed?: RepositoryWorkProvider[] } {
  const policy = allowedRoute(bound).allowed;
  if (policy === undefined && executors === undefined) return {};
  const all: RepositoryWorkProvider[] = ["codex", "claude"];
  return {
    allowed: all.filter(
      (provider) =>
        (policy === undefined || policy.includes(provider)) &&
        (executors === undefined || executors[provider] !== undefined),
    ),
  };
}

/**
 * Selects the requested work profile while replaying each event on its original provider.
 *
 * ADR-0612: the profile's role (or `routine`) of the model selection decides at each call. A
 * replayed event, a continued session, or a bound agent keeps its provider, and takes the role's
 * route for it when the role lists one. Otherwise a set role chooses the provider too, and the
 * configured profile stands while the role is unset.
 */
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
  executables?: Partial<Record<RepositoryWorkProvider, string>>;
  /** This Node's repository work executors; a selected route uses only a provider it has. */
  executors?: Partial<Record<RepositoryWorkProvider, unknown>>;
  readSelection?: ReadNodeModelSelection;
  startable?: ProviderStartable;
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
  const role = input.executionProfile ?? "routine";
  const configuredRoute = profilePolicy?.providers[provider];
  const configured = {
    model:
      configuredRoute?.model ??
      (profilePolicy === undefined ? input.models?.[provider] : undefined),
    reasoningEffort:
      configuredRoute?.reasoningEffort ??
      (profilePolicy === undefined ? input.reasoningEfforts?.[provider] : undefined),
  };
  // One read of the selection decides the whole route.
  const snapshot = (input.readSelection ?? readHostNodeModelSelection)();
  const selection = { readSelection: () => snapshot };
  if (allocationReason === "profile_preference" || allocationReason === "configured_default") {
    const chosen = nodeRoleRoute({
      role,
      configured: { provider, ...optionalRouteFields(configured) },
      ...workAllowed(input.boundProvider, input.executors),
      ...(input.executables === undefined ? {} : { executables: input.executables }),
      ...selection,
      // A configured executor resolves its own executable, so having one is what makes a
      // provider available here; a PATH lookup would miss an absolute configured executable.
      startable: input.startable ?? (() => true),
    });
    if (chosen.source === "selection")
      return {
        provider: chosen.provider,
        model: chosen.model ?? null,
        reasoningEffort: chosen.reasoningEffort ?? null,
        executionProfile: input.executionProfile,
        allocationReason,
      };
  } else {
    const routed = nodeRouteForProvider({ role, provider, configured, ...selection });
    const listed = snapshot.roles[role] ?? [];
    if (listed.some((candidate) => candidate.provider === provider))
      return {
        provider,
        model: routed.model ?? null,
        reasoningEffort: routed.reasoningEffort ?? null,
        executionProfile: input.executionProfile,
        allocationReason,
      };
  }
  const route = configuredRoute;
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
