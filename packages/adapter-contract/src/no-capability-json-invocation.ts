/**
 * One provider CLI's translation of a no-capability, JSON-schema-constrained run: the arguments
 * and files a run needs, how its output proves the no-tool boundary, and how its usage is counted.
 * The caller owns process spawning, the environment, stdin, budgets, and its own failure contract.
 */
export type NoCapabilityJsonProvider = "codex" | "claude";

export type NoCapabilityJsonReasoningEffort = "low" | "medium" | "high" | "xhigh" | "max";

/** Normalized token usage of one run; `null` where the provider reported none. */
export interface NoCapabilityJsonUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  contextWindow: number | null;
}

/**
 * The response schema as canonical JSON text: as the caller requests it, and reduced to the
 * subset native structured output accepts. A provider that enforces only the subset uses it.
 */
export interface NoCapabilityJsonResponseSchema {
  requested: string;
  nativeSubset: string;
}

export interface NoCapabilityJsonRunRequest {
  /** The private, empty directory the run executes in; strategy files are placed inside it. */
  workingDirectory: string;
  responseSchema: NoCapabilityJsonResponseSchema;
  model?: string;
}

/** A run whose system prompt travels out of band and whose reasoning effort is explicit. */
export interface NoCapabilityInstructedJsonRunRequest extends NoCapabilityJsonRunRequest {
  reasoningEffort: NoCapabilityJsonReasoningEffort;
  systemPrompt?: string;
}

/** A run whose instruction is already part of stdin; a provider may also set it as its prompt. */
export interface NoCapabilityDocumentNormalizationRunRequest extends NoCapabilityJsonRunRequest {
  instruction: string;
}

export interface NoCapabilityJsonInvocation {
  arguments: string[];
  /** Files written with owner-only permissions, never overwritten, before the process starts. */
  files: Array<{ path: string; content: string }>;
}

export interface NoCapabilityJsonRunOutput {
  result: Record<string, unknown>;
  usage: NoCapabilityJsonUsage | null;
}

export interface NoCapabilityProcessRequest {
  arguments: readonly string[];
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface NoCapabilityProcessOutcome {
  status: string;
  stdout: string;
}

/** Runs the admitted executable in the caller's dispatch context. */
export type NoCapabilityProcessRunner = (
  request: NoCapabilityProcessRequest,
) => Promise<NoCapabilityProcessOutcome>;

/**
 * How a provider proves it exposes no tools: by printing its model input without a model call, or
 * by one model call whose exact reply proves the single-turn no-tool contract.
 */
export type NoCapabilityAdmission =
  | {
      kind: "model_input";
      assertNoModelTools(run: NoCapabilityProcessRunner, timeoutMs: number): Promise<void>;
    }
  | {
      kind: "model_call";
      arguments: readonly string[];
      stdin: string;
      usage(stdout: string): NoCapabilityJsonUsage | null;
      assertAdmitted(stdout: string): void;
    };

export interface NoCapabilityJsonInvocationStrategy {
  readonly provider: NoCapabilityJsonProvider;
  /** The provider capabilities every run disables; part of the caller's invocation identity. */
  readonly disabledCapabilities: readonly string[];
  /** Names how `parseRun` reads native token counters, for resource accounting descriptors. */
  readonly usageSemanticsId: string;
  readonly admission: NoCapabilityAdmission;
  instructedRun(request: NoCapabilityInstructedJsonRunRequest): NoCapabilityJsonInvocation;
  documentNormalizationRun(
    request: NoCapabilityDocumentNormalizationRunRequest,
  ): NoCapabilityJsonInvocation;
  /** Throws a policy violation unless the output proves no tool, permission, or server use. */
  parseRun(stdout: string): NoCapabilityJsonRunOutput;
  /** Whether one parsed native output event reports a provider failure, such as quota. */
  isNativeFailureEvent(event: Record<string, unknown>): boolean;
}

/** Only these closed tool names may leave an admission probe; arbitrary provider text stays. */
export const NO_CAPABILITY_PROBE_TOOL_NAMES = [
  "exec",
  "spawn_agent",
  "request_user_input",
  "send_input",
  "wait",
  "close_agent",
  "apply_patch",
  "shell",
  "shell_command",
  "read_file",
  "write_file",
  "web_search",
  "web_fetch",
  "mcp",
  "permission_request",
  "other",
] as const;

export interface NoCapabilityInvocationFailureDetails {
  providerReportedFailure?: true;
  exposedTools?: string[];
  probeFailureReason?: "probe_failed" | "probe_timed_out";
}

/**
 * `run_failed` means the run produced no usable result; `policy_violation` means its output did
 * not prove the no-capability boundary. Callers translate both into their own failure contract.
 */
export class NoCapabilityInvocationFailure extends Error {
  constructor(
    readonly kind: "run_failed" | "policy_violation",
    message: string,
    readonly details: NoCapabilityInvocationFailureDetails = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "NoCapabilityInvocationFailure";
  }
}

export function parsedNoCapabilityJson(value: string, message: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new NoCapabilityInvocationFailure("run_failed", message);
  }
}

export function parsedNoCapabilityJsonObject(
  value: string,
  message: string,
): Record<string, unknown> {
  const parsed = parsedNoCapabilityJson(value, message);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed))
    throw new NoCapabilityInvocationFailure("run_failed", message);
  return parsed as Record<string, unknown>;
}

/** A final reply as JSON: bare, fenced, or the one object inside surrounding text. */
export function parseNoCapabilityResultText(value: string, provider: "Codex" | "Claude"): unknown {
  const trimmed = value.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start)
      throw new NoCapabilityInvocationFailure(
        "run_failed",
        `${provider} final response is not JSON.`,
      );
    return parsedNoCapabilityJson(
      candidate.slice(start, end + 1),
      `${provider} final response is not a single JSON object.`,
    );
  }
}

export function nonNegativeUsageInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}
