import type { NoCapabilityJsonInvocationStrategy } from "@lervo/adapter-contract";
import { claudeNoCapabilityJsonInvocationStrategy } from "@lervo/adapter-claude/no-capability-json";
import { codexNoCapabilityJsonInvocationStrategy } from "@lervo/adapter-codex";

/** The adapters' real strategies, so fake provider executables test the composed boundary. */
export function strategyFor(provider: "codex" | "claude"): NoCapabilityJsonInvocationStrategy {
  return provider === "claude"
    ? claudeNoCapabilityJsonInvocationStrategy
    : codexNoCapabilityJsonInvocationStrategy;
}
