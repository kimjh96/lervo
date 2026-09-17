import type {
  NodeRepositoryWorkExecutionProfile,
  NodeRepositoryWorkExecutionProfilePolicy,
} from "./config-types.js";
import { configRecord, configText, exactConfigKeys } from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";

const MODEL_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export function providerExecutionProfiles(
  value: unknown,
  providers: readonly ("codex" | "claude")[],
):
  Record<NodeRepositoryWorkExecutionProfile, NodeRepositoryWorkExecutionProfilePolicy> | undefined {
  if (value === undefined) return undefined;
  const source = configRecord(value, "remoteCommands.providerHost.executionProfiles");
  const profileIds = ["routine", "reasoning", "review"] as const;
  exactConfigKeys(source, profileIds, "remoteCommands.providerHost.executionProfiles");
  const result = {} as Record<
    NodeRepositoryWorkExecutionProfile,
    NodeRepositoryWorkExecutionProfilePolicy
  >;
  for (const profileId of profileIds) {
    const label = `remoteCommands.providerHost.executionProfiles.${profileId}`;
    const profile = configRecord(source[profileId], label);
    exactConfigKeys(profile, ["preferredProvider", "providers"], label);
    const preferredProvider = configText(profile.preferredProvider, `${label}.preferredProvider`);
    const routes = configRecord(profile.providers, `${label}.providers`);
    const routeProviders = Object.keys(routes);
    if (
      !providers.includes(preferredProvider as "codex" | "claude") ||
      routeProviders.length < 1 ||
      routeProviders.length > 2 ||
      routeProviders.some(
        (provider) =>
          !["codex", "claude"].includes(provider) ||
          !providers.includes(provider as "codex" | "claude"),
      ) ||
      !routeProviders.includes(preferredProvider)
    ) {
      throw new NodeRuntimeError("invalid_config", `${label} has an invalid provider route.`);
    }
    const parsedRoutes: NodeRepositoryWorkExecutionProfilePolicy["providers"] = {};
    for (const provider of routeProviders as Array<"codex" | "claude">) {
      const routeLabel = `${label}.providers.${provider}`;
      const route = configRecord(routes[provider], routeLabel);
      exactConfigKeys(route, ["model", "reasoningEffort"], routeLabel);
      const reasoningEffort = configText(route.reasoningEffort, `${routeLabel}.reasoningEffort`);
      const model =
        route.model === undefined ? undefined : configText(route.model, `${routeLabel}.model`);
      if (
        !REASONING_EFFORTS.includes(reasoningEffort as (typeof REASONING_EFFORTS)[number]) ||
        (model !== undefined && !MODEL_PATTERN.test(model)) ||
        (profileId === "routine" && !["low", "medium"].includes(reasoningEffort)) ||
        (profileId !== "routine" && !["high", "xhigh", "max"].includes(reasoningEffort))
      ) {
        throw new NodeRuntimeError(
          "invalid_config",
          `${routeLabel} does not satisfy its execution quality floor.`,
        );
      }
      parsedRoutes[provider] = {
        ...(model === undefined ? {} : { model }),
        reasoningEffort: reasoningEffort as (typeof REASONING_EFFORTS)[number],
      };
    }
    result[profileId] = {
      preferredProvider: preferredProvider as "codex" | "claude",
      providers: parsedRoutes,
    };
  }
  if (
    providers.length > 1 &&
    result.reasoning.preferredProvider === result.review.preferredProvider
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "Reasoning and review execution profiles must prefer different providers when both are available.",
    );
  }
  return result;
}
