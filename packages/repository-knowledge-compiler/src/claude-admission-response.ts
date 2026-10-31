import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";

/** Admission has no native structured-output tool. Only the exact single-turn reply qualifies. */
export function assertClaudeAdmissionResponse(stdout: string): void {
  let wrapper: Record<string, unknown>;
  try {
    wrapper = JSON.parse(stdout) as Record<string, unknown>;
  } catch (cause) {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "Claude admission returned invalid JSON.",
      undefined,
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
    throw new RepositoryKnowledgeError(
      "knowledge_compile_policy_violation",
      "Claude admission did not prove the single-turn no-tool contract.",
    );
  }
}
