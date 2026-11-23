import { createNoCapabilityProviderJsonRunner } from "@lervo/repository-knowledge-compiler";
import type { ProviderJsonRequest } from "@lervo/schemas";

import {
  createConversationIntentResolver,
  type ConversationIntentProviderPort,
  type ConversationIntentResolver,
} from "./conversation-intent-resolver.js";
import {
  allowedRoute,
  cliStartable,
  NodeModelRouteError,
  nodeRoleRoute,
  optionalRouteFields,
  type NodeProviderRoute,
  type ProviderStartable,
  type ReadNodeModelSelection,
} from "./node-model-route.js";

/**
 * The provider-backed intent resolver. ADR-0612: each turn resolves on the `routine` route current
 * at that turn, and one runner per route is opened and reused; the configured route stands while
 * the role is unset.
 */
export async function createProviderConversationIntentResolver(input: {
  provider: "codex" | "claude";
  executable?: string;
  /** Executables by provider, for a route the `routine` role selects. */
  executables?: Partial<Record<"codex" | "claude", string>>;
  model?: string;
  timeoutMs?: number;
  /** ADR-0612: the hired agent's provider policy, which bounds the routes it may use. */
  providerPolicy?: "codex" | "claude" | "any" | null;
  readModelSelection?: ReadNodeModelSelection;
  startable?: ProviderStartable;
}): Promise<ConversationIntentResolver> {
  const runners = new Map<string, Promise<ConversationIntentProviderPort>>();
  const open = (route: NodeProviderRoute): Promise<ConversationIntentProviderPort> => {
    const key = JSON.stringify([
      route.provider,
      route.model ?? null,
      route.reasoningEffort ?? null,
    ]);
    let opened = runners.get(key);
    if (opened === undefined) {
      const executable =
        input.executables?.[route.provider] ??
        (route.provider === input.provider ? input.executable : undefined);
      opened = createNoCapabilityProviderJsonRunner({
        provider: route.provider,
        ...(executable === undefined ? {} : { executable }),
        ...optionalRouteFields(route),
        ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
      }).then((runner) => ({
        providerId: route.provider,
        model: route.model ?? null,
        resolve: (value: ProviderJsonRequest) => runner.resolve(value),
      }));
      // A runner that could not start is opened again at the next turn, not cached as failed.
      opened.catch(() => runners.delete(key));
      runners.set(key, opened);
    }
    return opened;
  };
  const configured: NodeProviderRoute = {
    provider: input.provider,
    ...(input.model === undefined ? {} : { model: input.model }),
  };
  // The configured route opens now, as before, so a Node that cannot start it fails at startup.
  const current = () =>
    nodeRoleRoute({
      role: "routine",
      configured,
      ...allowedRoute(input.providerPolicy),
      ...(input.executables === undefined ? {} : { executables: input.executables }),
      ...(input.readModelSelection === undefined
        ? {}
        : { readSelection: input.readModelSelection }),
      // The intent runner spawns the provider CLI by name, so the bundled SDK binary does not count.
      startable: input.startable ?? cliStartable,
    });
  // The route current at startup opens now, as the configured one did, so a Node that cannot
  // start it fails at startup. A role that admits nothing here waits per turn instead.
  try {
    await open(current());
  } catch (error) {
    if (!(error instanceof NodeModelRouteError)) throw error;
  }
  return createConversationIntentResolver(() => open(current()));
}
