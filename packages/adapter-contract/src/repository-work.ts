export type RepositoryWorkProvider = "codex" | "claude";

export type RepositoryWorkReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface RepositoryWorkTurnRequest {
  repositoryRoot: string;
  instructions: string;
  providerSessionId: string | null;
  model?: string;
  reasoningEffort?: RepositoryWorkReasoningEffort;
  externalEffectsAuthorized?: boolean;
  /** Maximum time without a provider-native progress event; an absolute turn bound also applies. */
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Provider-reported token counters for the turn, normalized by the adapter. */
export interface RepositoryWorkTurnTokenUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  contextWindow: number | null;
}

export type RepositoryWorkTurnUsage = {
  adapterId: string;
  /** Names the native counter semantics the adapter normalized. */
  nativeCounterSemanticsId: string;
} & (
  | { status: "observed"; usage: RepositoryWorkTurnTokenUsage }
  | { status: "unavailable"; reasonCode: string }
);

export interface RepositoryWorkTurnResult {
  provider: RepositoryWorkProvider;
  providerSessionId: string;
  response: string;
  completedAt: string;
  /** Absent only for executors that predate ADR-0459; the host records the gap. */
  usage?: RepositoryWorkTurnUsage;
}

/**
 * Executes one resumable provider turn with the provider's native repository tools.
 * Authorization and repository selection remain application responsibilities.
 */
export interface RepositoryWorkTurnExecutor {
  readonly provider: RepositoryWorkProvider;
  execute(request: RepositoryWorkTurnRequest): Promise<RepositoryWorkTurnResult>;
}

export class RepositoryWorkExecutionError extends Error {
  constructor(
    readonly code:
      | "provider_process_failed"
      | "provider_protocol_failed"
      | "provider_result_failed"
      | "provider_turn_timeout"
      | "provider_turn_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryWorkExecutionError";
  }
}
