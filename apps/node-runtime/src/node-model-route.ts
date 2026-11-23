import {
  DEFAULT_MODEL_SELECTION,
  DEFAULT_ROLE_REASONING_EFFORT,
  readModelSelectionSync,
  type ModelProvider,
  type ModelReasoningEffort,
  type ModelRole,
  type ModelSelection,
} from "@lervo/execution-contract";
import { hostModelSelectionDirectory } from "@lervo/repository-knowledge-runtime";

/** One provider call's route: an absent model or effort keeps the provider default. */
export interface NodeProviderRoute {
  provider: ModelProvider;
  model?: string;
  reasoningEffort?: ModelReasoningEffort;
}

/** Reads the host selection; replaced only in tests. */
export type ReadNodeModelSelection = () => ModelSelection;

/**
 * ADR-0612: the host's selection, read at each provider call. An unchanged file costs one
 * `lstat`; an unusable file or state directory reads as the defaults, so a damaged record never
 * stops a conversation.
 */
export const readHostNodeModelSelection: ReadNodeModelSelection = () => {
  try {
    return readModelSelectionSync(hostModelSelectionDirectory()).selection;
  } catch {
    return DEFAULT_MODEL_SELECTION;
  }
};

/**
 * The route a Node call in `role` uses. When the role has routes, the first one whose provider
 * the caller may use wins, with its model and effort; the Node configuration's own provider and
 * model then no longer decide. When the role is unset, or lists only providers the caller may not
 * use, the configured route stands unchanged, as before ADR-0612.
 */
export function nodeRoleRoute(input: {
  role: ModelRole;
  configured: NodeProviderRoute;
  /** The providers the caller's authority allows, such as the hired agent's provider policy. */
  allowed?: readonly ModelProvider[];
  readSelection?: ReadNodeModelSelection;
}): NodeProviderRoute & { source: "selection" | "configuration" } {
  const routes = (input.readSelection ?? readHostNodeModelSelection)().roles[input.role] ?? [];
  const route = routes.find(
    (candidate) => input.allowed === undefined || input.allowed.includes(candidate.provider),
  );
  if (route === undefined) return { ...input.configured, source: "configuration" };
  const reasoningEffort = route.reasoningEffort ?? DEFAULT_ROLE_REASONING_EFFORT[input.role];
  return {
    provider: route.provider,
    ...(route.model === null ? {} : { model: route.model }),
    ...(reasoningEffort === null ? {} : { reasoningEffort }),
    source: "selection",
  };
}

/** The providers a hired agent's provider policy allows; every provider without an agent. */
export function agentAllowedProviders(
  policy: "codex" | "claude" | "any" | null | undefined,
): ModelProvider[] | undefined {
  return policy === "codex" || policy === "claude" ? [policy] : undefined;
}

/** The `allowed` argument for a hired agent's provider policy; no bound without an agent. */
export function allowedRoute(policy: "codex" | "claude" | "any" | null | undefined): {
  allowed?: ModelProvider[];
} {
  const allowed = agentAllowedProviders(policy);
  return allowed === undefined ? {} : { allowed };
}

/** A route's model and effort as optional adapter options, dropping absent ones. */
export function optionalRouteFields(route: {
  model?: string | undefined;
  reasoningEffort?: ModelReasoningEffort | undefined;
}): { model?: string; reasoningEffort?: ModelReasoningEffort } {
  return {
    ...(route.model === undefined ? {} : { model: route.model }),
    ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
  };
}

/**
 * The model and effort for a call whose provider is already fixed, such as a signed remote
 * command: the role's route for that provider, or the configured values while the role lists none.
 */
export function nodeRouteForProvider(input: {
  role: ModelRole;
  provider: ModelProvider;
  configured: { model?: string | undefined; reasoningEffort?: ModelReasoningEffort | undefined };
  readSelection?: ReadNodeModelSelection;
}): { model?: string; reasoningEffort?: ModelReasoningEffort } {
  const route = (input.readSelection ?? readHostNodeModelSelection)().roles[input.role]?.find(
    (candidate) => candidate.provider === input.provider,
  );
  if (route === undefined) return optionalRouteFields(input.configured);
  const reasoningEffort = route.reasoningEffort ?? DEFAULT_ROLE_REASONING_EFFORT[input.role];
  return {
    ...(route.model === null ? {} : { model: route.model }),
    ...(reasoningEffort === null ? {} : { reasoningEffort }),
  };
}

/**
 * A conversation reply's route: the execution profile's role, or `routine` for a plain reply,
 * chooses at each call, and the configured profile or response route stands while it is unset.
 * The timeout stays the configured one for the chosen provider.
 */
export function conversationResponseRoute(input: {
  response: {
    provider: ModelProvider;
    model?: string;
    reasoningEffort?: ModelReasoningEffort;
    timeoutMs?: number;
  };
  executionProfile?: "routine" | "reasoning" | "review";
  profiles?: Partial<
    Record<
      "routine" | "reasoning" | "review",
      {
        preferredProvider: ModelProvider;
        providers: Partial<
          Record<
            ModelProvider,
            { model?: string; reasoningEffort: ModelReasoningEffort; timeoutMs?: number }
          >
        >;
      }
    >
  >;
  providerPolicy?: "codex" | "claude" | "any" | null | undefined;
  readSelection?: ReadNodeModelSelection;
}): NodeProviderRoute & { source: "selection" | "configuration"; timeoutMs: number } {
  const profile =
    input.executionProfile === undefined ? undefined : input.profiles?.[input.executionProfile];
  const provider = profile?.preferredProvider ?? input.response.provider;
  const configured = profile?.providers[provider];
  const route = nodeRoleRoute({
    role: input.executionProfile ?? "routine",
    configured: {
      provider,
      ...optionalRouteFields({
        model: configured?.model ?? input.response.model,
        reasoningEffort: configured?.reasoningEffort ?? input.response.reasoningEffort,
      }),
    },
    ...allowedRoute(input.providerPolicy),
    ...(input.readSelection === undefined ? {} : { readSelection: input.readSelection }),
  });
  return {
    ...route,
    timeoutMs: profile?.providers[route.provider]?.timeoutMs ?? input.response.timeoutMs ?? 60_000,
  };
}
