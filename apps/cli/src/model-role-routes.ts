import {
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

export const readHostSelection: ReadModelSelection = async () =>
  (await readHostModelSelection()).selection;

/**
 * ADR-0612: the options a call on `provider` in `role` uses. A role without a route for that
 * provider leaves the call exactly as before the selection existed, so an unset role changes
 * nothing.
 */
export function modelCallOptions(
  selection: ModelSelection,
  role: ModelRole,
  provider: ModelProvider,
): ModelCallOptions {
  const route = selection.roles[role]?.find((item) => item.provider === provider);
  if (route === undefined) return {};
  const reasoningEffort = route.reasoningEffort ?? DEFAULT_ROLE_REASONING_EFFORT[role];
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
  readSelection?: ReadModelSelection;
}): Promise<ProviderCallRoute[]> {
  const selection = await (input.readSelection ?? readHostSelection)();
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
      return { route, opened: await open(route) };
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}
