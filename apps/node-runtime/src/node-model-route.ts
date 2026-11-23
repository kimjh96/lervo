import {
  DEFAULT_MODEL_SELECTION,
  DEFAULT_ROLE_REASONING_EFFORT,
  readModelSelectionSync,
  type ModelProvider,
  type ModelReasoningEffort,
  type ModelRole,
  type ModelSelection,
} from "@lervo/execution-contract";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, isAbsolute, resolve } from "node:path";

import { bundledClaudeExecutable } from "@lervo/adapter-claude";
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

/** A set role lists no provider this caller may use and can start here (ADR-0612). */
export class NodeModelRouteError extends Error {
  readonly code = "provider_not_admitted";
  constructor(role: ModelRole) {
    super(
      `The ${role} model role lists no provider this agent may use and this host can start, so the call waits for a change to either.`,
    );
    this.name = "NodeModelRouteError";
  }
}

/** Whether this host can start a provider for a call: its configured executable or a default. */
export type ProviderStartable = (provider: ModelProvider, executable?: string) => boolean;

function executableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function onPath(name: string): boolean {
  const extensions =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)]
      : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter((directory) => directory.length > 0)
    .some((directory) =>
      extensions.some((extension) => executableFile(resolve(directory, `${name}${extension}`))),
    );
}

/** A provider CLI spawned by name, as the no-capability JSON runner does. */
export const cliStartable: ProviderStartable = (provider, executable) =>
  executable !== undefined && isAbsolute(executable)
    ? executableFile(executable)
    : onPath(executable ?? provider);

/**
 * A provider adapter: Claude without a configured executable runs the CLI bundled with the Agent
 * SDK, so it can start even when no `claude` is on PATH.
 */
export const adapterStartable: ProviderStartable = (provider, executable) => {
  if (provider === "claude" && executable === undefined) {
    const bundled = bundledClaudeExecutable();
    if (bundled !== null && executableFile(bundled)) return true;
  }
  return cliStartable(provider, executable);
};

/**
 * The route a Node call in `role` uses.
 *
 * - A role without routes keeps the configured route unchanged, as before ADR-0612.
 * - A role with routes decides: the first route whose provider the caller may use and this host
 *   can start wins, with its model and effort. A provider the role leaves out is never used, so
 *   setting a role to one provider really removes the other.
 * - When no listed route qualifies, the call waits with `provider_not_admitted`.
 */
export function nodeRoleRoute(input: {
  role: ModelRole;
  configured: NodeProviderRoute;
  /** The providers the caller's authority allows, such as the hired agent's provider policy. */
  allowed?: readonly ModelProvider[];
  /** Configured executables by provider, checked before a route is chosen. */
  executables?: Partial<Record<ModelProvider, string>>;
  readSelection?: ReadNodeModelSelection;
  startable?: ProviderStartable;
}): NodeProviderRoute & { source: "selection" | "configuration" } {
  const routes = (input.readSelection ?? readHostNodeModelSelection)().roles[input.role] ?? [];
  if (routes.length === 0) return { ...input.configured, source: "configuration" };
  const startable = input.startable ?? adapterStartable;
  const route = routes.find(
    (candidate) =>
      (input.allowed === undefined || input.allowed.includes(candidate.provider)) &&
      startable(candidate.provider, input.executables?.[candidate.provider]),
  );
  if (route === undefined) throw new NodeModelRouteError(input.role);
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
  executables?: Partial<Record<ModelProvider, string>>;
  readSelection?: ReadNodeModelSelection;
  startable?: ProviderStartable;
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
    ...(input.executables === undefined ? {} : { executables: input.executables }),
    ...(input.readSelection === undefined ? {} : { readSelection: input.readSelection }),
    ...(input.startable === undefined ? {} : { startable: input.startable }),
  });
  // A provider the profile does not configure keeps the profile's own timeout, so a long
  // reasoning turn is not cut to the short reply bound.
  return {
    ...route,
    timeoutMs:
      profile?.providers[route.provider]?.timeoutMs ??
      configured?.timeoutMs ??
      input.response.timeoutMs ??
      60_000,
  };
}

/**
 * ADR-0612 M2c: the model and effort of supervision owner reasoning. Its provider stays the
 * configured one, because the supervision mandate reviews it; the `reasoning` route for that
 * provider sets the model and effort, and the configured model stands while the role lists none.
 */
export function ownerReasoningRoute(input: {
  provider: ModelProvider;
  model?: string | undefined;
  readSelection?: ReadNodeModelSelection;
}): { model: string | null; reasoningEffort?: ModelReasoningEffort } {
  const routed = nodeRouteForProvider({
    role: "reasoning",
    provider: input.provider,
    configured: { model: input.model },
    ...(input.readSelection === undefined ? {} : { readSelection: input.readSelection }),
  });
  return {
    model: routed.model ?? null,
    ...(routed.reasoningEffort === undefined ? {} : { reasoningEffort: routed.reasoningEffort }),
  };
}
