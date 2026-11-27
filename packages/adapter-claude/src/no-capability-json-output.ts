import {
  NoCapabilityInvocationFailure,
  nonNegativeUsageInteger,
  parseNoCapabilityResultText,
  parsedNoCapabilityJsonObject,
  type NoCapabilityJsonUsage,
} from "@lervo/adapter-contract";

const INVALID_RESULT = "Claude did not return a valid JSON result.";

function policyViolation(message: string): NoCapabilityInvocationFailure {
  return new NoCapabilityInvocationFailure("policy_violation", message);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

/** Key-order-independent equality, by the same canonical form the knowledge compiler hashes. */
function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

/**
 * The native structured output of a `--print --output-format json --json-schema` run, proven to
 * match its final reply and to have used no tool, permission, or server tool.
 */
export function parseClaudeNoCapabilityOutput(stdout: string): Record<string, unknown> {
  const wrapper = parsedNoCapabilityJsonObject(stdout, INVALID_RESULT) as {
    is_error?: unknown;
    result?: unknown;
    structured_output?: unknown;
    permission_denials?: unknown;
    stop_reason?: unknown;
    num_turns?: unknown;
    usage?: { server_tool_use?: { web_search_requests?: unknown; web_fetch_requests?: unknown } };
  };
  if (
    wrapper.permission_denials !== undefined &&
    (!Array.isArray(wrapper.permission_denials) || wrapper.permission_denials.length > 0)
  ) {
    throw policyViolation("A capability permission request was observed during the Claude run.");
  }
  const serverTools = wrapper.usage?.server_tool_use;
  const structuredOutput = wrapper.structured_output;
  if (structuredOutput === undefined) {
    throw policyViolation("The Claude run did not return native structured output.");
  }
  if (
    wrapper.is_error !== false ||
    wrapper.stop_reason !== "tool_use" ||
    !Number.isSafeInteger(wrapper.num_turns) ||
    (wrapper.num_turns as number) < 2 ||
    (serverTools?.web_search_requests ?? 0) !== 0 ||
    (serverTools?.web_fetch_requests ?? 0) !== 0 ||
    typeof wrapper.result !== "string" ||
    typeof structuredOutput !== "object" ||
    structuredOutput === null ||
    Array.isArray(structuredOutput)
  ) {
    throw policyViolation("The Claude run did not prove the native structured-output contract.");
  }
  const resultObject = parseNoCapabilityResultText(wrapper.result, "Claude");
  if (!sameJson(resultObject, structuredOutput)) {
    throw policyViolation("The Claude native structured output does not match its final result.");
  }
  return structuredOutput as Record<string, unknown>;
}

/** Sums `modelUsage` rows; cache reads and writes count as input, as the provider bills them. */
export function claudeNoCapabilityUsage(stdout: string): NoCapabilityJsonUsage | null {
  const wrapper = parsedNoCapabilityJsonObject(stdout, INVALID_RESULT) as {
    modelUsage?: unknown;
  };
  if (
    typeof wrapper.modelUsage !== "object" ||
    wrapper.modelUsage === null ||
    Array.isArray(wrapper.modelUsage)
  ) {
    return null;
  }
  const totals: NoCapabilityJsonUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    contextWindow: null,
  };
  const rows = Object.values(wrapper.modelUsage as Record<string, unknown>);
  if (rows.length === 0) return null;
  for (const value of rows) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    const inputTokens = nonNegativeUsageInteger(row.inputTokens);
    const outputTokens = nonNegativeUsageInteger(row.outputTokens);
    const cacheReadInputTokens = nonNegativeUsageInteger(row.cacheReadInputTokens);
    const cacheCreationInputTokens = nonNegativeUsageInteger(row.cacheCreationInputTokens);
    const contextWindow = nonNegativeUsageInteger(row.contextWindow);
    if (
      inputTokens === null ||
      outputTokens === null ||
      cacheReadInputTokens === null ||
      cacheCreationInputTokens === null ||
      contextWindow === null
    ) {
      return null;
    }
    const completeInputTokens = inputTokens + cacheReadInputTokens + cacheCreationInputTokens;
    totals.inputTokens += completeInputTokens;
    totals.cachedInputTokens += cacheReadInputTokens;
    totals.outputTokens += outputTokens;
    totals.totalTokens += completeInputTokens + outputTokens;
    totals.contextWindow = Math.max(totals.contextWindow ?? 0, contextWindow);
  }
  return totals;
}

/** Admission has no native structured-output tool. Only the exact single-turn reply qualifies. */
export function assertClaudeAdmissionResponse(stdout: string): void {
  let wrapper: Record<string, unknown>;
  try {
    wrapper = JSON.parse(stdout) as Record<string, unknown>;
  } catch (cause) {
    throw new NoCapabilityInvocationFailure(
      "run_failed",
      "Claude admission returned invalid JSON.",
      {},
      { cause },
    );
  }
  const usage = wrapper?.usage as { server_tool_use?: unknown } | undefined;
  const tools = usage?.server_tool_use;
  const noServerTools =
    typeof tools === "object" &&
    tools !== null &&
    !Array.isArray(tools) &&
    (tools as Record<string, unknown>).web_search_requests === 0 &&
    (tools as Record<string, unknown>).web_fetch_requests === 0 &&
    Object.values(tools).every((count) => count === 0);
  if (
    wrapper === null ||
    typeof wrapper !== "object" ||
    Array.isArray(wrapper) ||
    Object.hasOwn(wrapper, "structured_output") ||
    wrapper.is_error !== false ||
    wrapper.stop_reason !== "end_turn" ||
    wrapper.num_turns !== 1 ||
    !Array.isArray(wrapper.permission_denials) ||
    wrapper.permission_denials.length !== 0 ||
    !noServerTools ||
    wrapper.result !== '{"ok":true}'
  ) {
    throw policyViolation("Claude admission did not prove the single-turn no-tool contract.");
  }
}
