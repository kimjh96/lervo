export type RepositoryWorkProvider = "codex" | "claude";

export type RepositoryWorkReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

export interface RepositoryWorkTurnRequest {
  repositoryRoot: string;
  instructions: string;
  providerSessionId: string | null;
  model?: string;
  reasoningEffort?: RepositoryWorkReasoningEffort;
  externalEffectsAuthorized?: boolean;
  timeoutMs: number;
  signal?: AbortSignal;
}

export interface RepositoryWorkTurnResult {
  provider: RepositoryWorkProvider;
  providerSessionId: string;
  response: string;
  completedAt: string;
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
      | "provider_turn_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RepositoryWorkExecutionError";
  }
}
