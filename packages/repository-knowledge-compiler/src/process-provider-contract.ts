type Provider = "codex" | "claude";

export interface CreateProcessSemanticCompilerOptions {
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
  resolve(input: unknown, signal?: AbortSignal): Promise<unknown>;
  resolveObserved?(
    input: unknown,
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
