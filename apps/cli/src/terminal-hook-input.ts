import type { ParsedTerminalHookInput } from "./terminal-hook-contract.js";

export function parseTerminalHookInput(value: string): ParsedTerminalHookInput {
  if (Buffer.byteLength(value) > 256 * 1024)
    throw new Error("Hook input exceeds the bounded input limit.");
  const parsed = JSON.parse(value) as {
    hook_event_name?: unknown;
    session_id?: unknown;
    turn_id?: unknown;
    prompt?: unknown;
    stop_hook_active?: unknown;
    last_assistant_message?: unknown;
  };
  if (parsed?.hook_event_name !== "UserPromptSubmit" && parsed?.hook_event_name !== "Stop")
    throw new Error("Unsupported provider hook event.");
  if (
    typeof parsed.session_id !== "string" ||
    parsed.session_id.trim() === "" ||
    parsed.session_id.length > 512
  )
    throw new Error("The provider session coordinate is missing or invalid.");
  if (
    parsed.turn_id !== undefined &&
    (typeof parsed.turn_id !== "string" ||
      parsed.turn_id.trim() === "" ||
      parsed.turn_id.length > 512)
  )
    throw new Error("The provider turn coordinate is invalid.");
  if (
    parsed.hook_event_name === "UserPromptSubmit" &&
    (typeof parsed.prompt !== "string" ||
      parsed.prompt.trim() === "" ||
      parsed.prompt.length > 64 * 1024)
  )
    throw new Error("The prompt is missing or exceeds the bounded prompt limit.");
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
    ...(typeof parsed.prompt === "string" ? { prompt: parsed.prompt } : {}),
    ...(parsed.last_assistant_message === null || typeof parsed.last_assistant_message === "string"
      ? { lastAssistantMessage: parsed.last_assistant_message }
      : {}),
  };
}
