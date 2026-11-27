import type {
  NoCapabilityJsonInvocationStrategy,
  NoCapabilityJsonProvider,
} from "@lervo/adapter-contract";
import { claudeNoCapabilityJsonInvocationStrategy } from "@lervo/adapter-claude/no-capability-json";
import { codexNoCapabilityJsonInvocationStrategy } from "@lervo/adapter-codex";

/**
 * Composition of the knowledge compiler with the provider adapters: the compiler receives a
 * strategy and never names a provider. The Claude entry is a subpath that omits the Agent SDK.
 */
export function noCapabilityJsonInvocationStrategy(
  provider: NoCapabilityJsonProvider,
): NoCapabilityJsonInvocationStrategy {
  return provider === "claude"
    ? claudeNoCapabilityJsonInvocationStrategy
    : codexNoCapabilityJsonInvocationStrategy;
}
