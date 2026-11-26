import type {
  ParsedPreToolUseInput,
  ParsedSessionStartInput,
  ParsedTerminalHookInput,
} from "./terminal-hook-contract.js";

const SESSION_START_SOURCES = new Set(["startup", "resume", "clear", "compact"]);
const PROMPT_MAXIMUM_LENGTH = 64 * 1024;

/**
 * ADR-0635: a prompt is never refused for its text. An image-only message has empty text, and a
 * long paste is cut to the bound the hook reads, never split inside a surrogate pair.
 */
function boundedPrompt(prompt: string): string {
  if (prompt.length <= PROMPT_MAXIMUM_LENGTH) return prompt;
  const cut = prompt.slice(0, PROMPT_MAXIMUM_LENGTH);
  const last = cut.charCodeAt(cut.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? cut.slice(0, -1) : cut;
}

/** A prompt or Stop hook input; a `SessionStart` or `PreToolUse` input is refused here. */
export function parseTerminalHookInput(value: string): ParsedTerminalHookInput {
  const input = parseTerminalHookIngress(value);
  if (input.event === "SessionStart" || input.event === "PreToolUse")
    throw new Error("Unsupported provider hook event.");
  return input;
}

/** Any hook input the terminal runtime answers, including `SessionStart` and `PreToolUse`. */
export function parseTerminalHookIngress(
  value: string,
): ParsedTerminalHookInput | ParsedSessionStartInput | ParsedPreToolUseInput {
  if (Buffer.byteLength(value) > 256 * 1024)
    throw new Error("Hook input exceeds the bounded input limit.");
  const parsed = JSON.parse(value) as {
    hook_event_name?: unknown;
    source?: unknown;
    session_id?: unknown;
    turn_id?: unknown;
    prompt?: unknown;
    stop_hook_active?: unknown;
    last_assistant_message?: unknown;
    transcript_path?: unknown;
    tool_name?: unknown;
    tool_input?: unknown;
    tool_use_id?: unknown;
    cwd?: unknown;
  };
  if (
    parsed?.hook_event_name !== "UserPromptSubmit" &&
    parsed?.hook_event_name !== "Stop" &&
    parsed?.hook_event_name !== "SessionStart" &&
    parsed?.hook_event_name !== "PreToolUse"
  )
    throw new Error("Unsupported provider hook event.");
  if (
    typeof parsed.session_id !== "string" ||
    parsed.session_id.trim() === "" ||
    parsed.session_id.length > 512
  )
    throw new Error("The provider session coordinate is missing or invalid.");
  if (parsed.hook_event_name === "PreToolUse") {
    if (typeof parsed.tool_name !== "string" || !/^[A-Za-z][\w-]{0,127}$/u.test(parsed.tool_name))
      throw new Error("The provider tool name is missing or invalid.");
    return {
      event: "PreToolUse",
      providerSessionId: parsed.session_id,
      toolName: parsed.tool_name,
      toolInput: parsed.tool_input,
      toolUseId:
        typeof parsed.tool_use_id === "string" && parsed.tool_use_id.length <= 512
          ? parsed.tool_use_id
          : null,
      workingDirectory:
        typeof parsed.cwd === "string" &&
        parsed.cwd.startsWith("/") &&
        parsed.cwd.length <= 4096 &&
        !parsed.cwd.includes("\0")
          ? parsed.cwd
          : null,
    };
  }
  if (parsed.hook_event_name === "SessionStart")
    return {
      event: "SessionStart",
      providerSessionId: parsed.session_id,
      // An unknown or missing source still starts an epoch, as a new session.
      source:
        typeof parsed.source === "string" && SESSION_START_SOURCES.has(parsed.source)
          ? (parsed.source as ParsedSessionStartInput["source"])
          : "startup",
      ...(typeof parsed.transcript_path === "string" && parsed.transcript_path.length <= 4096
        ? { transcriptPath: parsed.transcript_path }
        : {}),
    };
  if (
    parsed.turn_id !== undefined &&
    (typeof parsed.turn_id !== "string" ||
      parsed.turn_id.trim() === "" ||
      parsed.turn_id.length > 512)
  )
    throw new Error("The provider turn coordinate is invalid.");
  if (parsed.hook_event_name === "UserPromptSubmit" && typeof parsed.prompt !== "string")
    throw new Error("The prompt is missing.");
  if (
    parsed.hook_event_name === "Stop" &&
    parsed.stop_hook_active !== undefined &&
    typeof parsed.stop_hook_active !== "boolean"
  )
    throw new Error("The provider Stop continuation state is invalid.");
  if (
    parsed.hook_event_name === "Stop" &&
    parsed.last_assistant_message !== undefined &&
    parsed.last_assistant_message !== null &&
    typeof parsed.last_assistant_message !== "string"
  )
    throw new Error("The provider completion message is invalid.");
  return {
    event: parsed.hook_event_name,
    providerSessionId: parsed.session_id,
    providerTurnId: typeof parsed.turn_id === "string" ? parsed.turn_id : null,
    stopHookActive: parsed.stop_hook_active === true,
    ...(typeof parsed.transcript_path === "string" &&
    parsed.transcript_path.length <= 4096 &&
    !parsed.transcript_path.includes("\0")
      ? { transcriptPath: parsed.transcript_path }
      : {}),
    ...(typeof parsed.prompt === "string" ? { prompt: boundedPrompt(parsed.prompt) } : {}),
    ...(parsed.last_assistant_message === null || typeof parsed.last_assistant_message === "string"
      ? { lastAssistantMessage: parsed.last_assistant_message }
      : {}),
  };
}
