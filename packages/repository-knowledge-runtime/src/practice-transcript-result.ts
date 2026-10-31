import type { PracticeStep } from "./practice-state.js";

function structuredOutput(result: Record<string, unknown>): Record<string, unknown> {
  let value = result.output ?? result.content;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** Native session coordinates link polling results without retaining command arguments or output. */
export function practiceResultSession(result: Record<string, unknown>): string | null {
  const output = result.output ?? result.content;
  const id =
    result.session_id ??
    structuredOutput(result).session_id ??
    (typeof output === "string"
      ? /(?:Process running with session ID|Session ID:)\s*(\d+)/iu.exec(output)?.[1]
      : undefined);
  return typeof id === "string" || typeof id === "number" ? String(id) : null;
}

export function practiceResultOutcome(result: Record<string, unknown>): PracticeStep["outcome"] {
  if (result.is_error === true) return "failed";
  const output = result.output ?? result.content;
  const structured = structuredOutput(result);
  const code =
    result.exit_code ??
    result.exitCode ??
    structured.exit_code ??
    structured.exitCode ??
    (typeof output === "string"
      ? /(?:Process exited with code|Exit code:)\s*(-?\d+)/u.exec(output)?.[1]
      : undefined);
  if (code !== undefined) return Number(code) === 0 ? "passed" : "failed";
  if (practiceResultSession(result) !== null) return "unknown";
  return result.is_error === false ? "passed" : "unknown";
}
