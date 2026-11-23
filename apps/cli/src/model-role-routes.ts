import {
  DEFAULT_MODEL_SELECTION,
  DEFAULT_ROLE_REASONING_EFFORT,
  type ModelProvider,
  type ModelReasoningEffort,
  type ModelRole,
  type ModelSelection,
} from "@lervo/execution-contract";
import {
  readHostModelSelection,
  readWorkerProviderSelection,
} from "@lervo/repository-knowledge-runtime";

/** The model and effort options of one provider call; an absent field keeps the provider default. */
export interface ModelCallOptions {
  model?: string;
  reasoningEffort?: ModelReasoningEffort;
}

export interface ProviderCallRoute extends ModelCallOptions {
  provider: ModelProvider;
}

/** Reads the host selection; replaced only in tests. */
export type ReadModelSelection = () => Promise<ModelSelection>;

/**
 * An unusable selection file already reads as the defaults; an unusable state directory does too,
 * so choosing a model never stops a provider call that worked before the selection existed.
 */
export const readHostSelection: ReadModelSelection = async () => {
  try {
    return (await readHostModelSelection()).selection;
  } catch {
    return DEFAULT_MODEL_SELECTION;
  }
};

/**
 * ADR-0612: the options a call on `provider` in `role` uses. An unset role leaves the call exactly
 * as before the selection existed. A set role that does not list a provider the caller named still
 * keeps the role's effort floor, so naming a provider never lowers a review below `high`.
 */
export function modelCallOptions(
  selection: ModelSelection,
  role: ModelRole,
  provider: ModelProvider,
): ModelCallOptions {
  const routes = selection.roles[role] ?? [];
  if (routes.length === 0) return {};
  const route = routes.find((item) => item.provider === provider);
  const reasoningEffort = route?.reasoningEffort ?? DEFAULT_ROLE_REASONING_EFFORT[role];
  if (route === undefined) return reasoningEffort === null ? {} : { reasoningEffort };
  return {
    ...(route.model === null ? {} : { model: route.model }),
    ...(reasoningEffort === null ? {} : { reasoningEffort }),
  };
}

/**
 * The provider calls an independent review (ADR-0561) may make, in order. A provider the caller
 * named stands, with the `review` route for it when the role lists one. Otherwise the role's
 * routes decide, and a provider the role leaves out is never tried. With no routes, the provider
 * the resident last admitted, as before ADR-0612. Empty when nothing names a provider.
 */
export async function reviewCallRoutes(input: {
  repositoryRoot: string;
  provider?: ModelProvider;
  selection: ModelSelection;
}): Promise<ProviderCallRoute[]> {
  const { selection } = input;
  const routed = (provider: ModelProvider): ProviderCallRoute => ({
    provider,
    ...modelCallOptions(selection, "review", provider),
  });
  if (input.provider !== undefined) return [routed(input.provider)];
  const routes = selection.roles.review ?? [];
  if (routes.length > 0)
    return [...new Set(routes.map((route) => route.provider))].map((provider) => routed(provider));
  const admitted = (await readWorkerProviderSelection(input.repositoryRoot))?.provider;
  return admitted === undefined ? [] : [routed(admitted)];
}

/** The provider CLI of a route could not start, so the next route may be tried. */
export class ProviderRouteStartError extends Error {
  constructor(
    readonly provider: ModelProvider,
    options: { cause: unknown },
  ) {
    super(`The ${provider} provider could not start a session.`, options);
    this.name = "ProviderRouteStartError";
  }
}

/** Opens a session, marking a failure to start so callers can tell it from a failed call. */
export async function startRoute<T>(
  route: ProviderCallRoute,
  open: (route: ProviderCallRoute) => Promise<T>,
): Promise<T> {
  try {
    return await open(route);
  } catch (error) {
    throw new ProviderRouteStartError(route.provider, { cause: error });
  }
}

/**
 * Opens a provider session on the first route that can start. A route whose provider CLI cannot
 * start here falls through to the next. The caller makes its one call on the opened session, so a
 * call that started and then failed is reported, never repeated on another provider.
 */
export async function openFirstRoute<T>(
  routes: readonly ProviderCallRoute[],
  open: (route: ProviderCallRoute) => Promise<T>,
): Promise<{ route: ProviderCallRoute; opened: T }> {
  let failure: unknown = new Error("No provider route is available.");
  for (const route of routes) {
    try {
      return { route, opened: await startRoute(route, open) };
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}
