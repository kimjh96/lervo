import type { ProviderJsonRequest } from "@lervo/repository-knowledge";

export type { ProviderJsonRequest };
type Provider = "codex" | "claude";

/** Capability counters a no-capability provider run must report as zero. */
export interface NoCapabilityTelemetry {
  filesystemReads: number;
  filesystemWrites: number;
  shellProcesses: number;
  networkRequests: number;
  externalActions: number;
  toolCalls: number;
  complete: true;
}

export interface CreateProcessProviderOptions {
  provider: Provider;
  executable?: string;
  environment?: NodeJS.ProcessEnv;
  identityHash?: string;
  beforeCall?: () => Promise<void>;
  onCall?: () => Promise<void>;
  model?: string;
  systemPrompt?: string;
  timeoutMs?: number;
}

export interface NoCapabilityProviderJsonRunner {
  provider: Provider;
  resolve(input: ProviderJsonRequest, signal?: AbortSignal): Promise<unknown>;
  resolveObserved?(
    input: ProviderJsonRequest,
    signal?: AbortSignal,
  ): Promise<{
    value: unknown;
    usage: ProviderJsonUsage | null;
  }>;
}

export interface ProviderJsonUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  contextWindow: number | null;
}
