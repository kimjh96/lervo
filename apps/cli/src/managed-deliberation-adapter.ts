import type { ProviderAdapter } from "@lervo/adapter-contract";
import { ClaudeAdapter } from "@lervo/adapter-claude";
import { CodexAdapter } from "@lervo/adapter-codex";

import type { RunProvider } from "./managed-run.js";
import type { ProviderOutputSchema } from "@lervo/schemas";

export const managedDeliberationEvidenceBoundaryInstruction = [
  "Use only the Lervo-injected canonical documents and shared deliberation publications as evidence.",
  "Do not inspect the repository or filesystem and do not invoke tools, commands, agents, or network access.",
  "Return the requested bounded artifact directly from the injected evidence.",
].join(" ");

export function managedDeliberationProviderBoundary(
  provider: RunProvider,
):
  | { provider: "codex"; baseInstructions: string }
  | { provider: "claude"; systemPrompt: string; tools: [] } {
  return provider === "codex"
    ? { provider, baseInstructions: managedDeliberationEvidenceBoundaryInstruction }
    : {
        provider,
        systemPrompt: managedDeliberationEvidenceBoundaryInstruction,
        tools: [],
      };
}

export function createManagedDeliberationAdapter(input: {
  provider: RunProvider;
  executable?: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  repositoryRoot: string;
  resolveArtifact: (uri: string) => Promise<Uint8Array>;
  structuredOutputSchema?: ProviderOutputSchema;
}): ProviderAdapter {
  const common = {
    repositoryRoot: input.repositoryRoot,
    resolveArtifact: input.resolveArtifact,
    ...(input.executable === undefined ? {} : { executable: input.executable }),
    ...(input.model === undefined ? {} : { model: input.model }),
    ...(input.reasoningEffort === undefined ? {} : { reasoningEffort: input.reasoningEffort }),
    ...(input.structuredOutputSchema === undefined
      ? {}
      : { structuredOutputSchema: input.structuredOutputSchema }),
  };
  const boundary = managedDeliberationProviderBoundary(input.provider);
  return boundary.provider === "codex"
    ? new CodexAdapter({ ...common, baseInstructions: boundary.baseInstructions })
    : new ClaudeAdapter({
        ...common,
        systemPrompt: boundary.systemPrompt,
        tools: boundary.tools,
      });
}
