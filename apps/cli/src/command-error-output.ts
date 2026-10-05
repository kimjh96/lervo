import type { CliIo } from "./types.js";

/** A command failure whose structured details must survive JSON output. */
export class CommandFailure extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "CommandFailure";
  }
}

interface CommandErrorEnvelope {
  schemaVersion: 1;
  status: "failed";
  error: {
    code: string;
    message: string;
    issues?: unknown[];
    [detail: string]: unknown;
  };
}

function errorCode(error: unknown): string {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "command_failed";
}

function commandErrorEnvelope(error: unknown): CommandErrorEnvelope {
  const issues =
    error !== null && typeof error === "object" && "issues" in error && Array.isArray(error.issues)
      ? { issues: [...error.issues] }
      : {};
  return {
    schemaVersion: 1,
    status: "failed",
    error: {
      code: errorCode(error),
      message: error instanceof Error ? error.message : String(error),
      ...issues,
      ...(error instanceof CommandFailure ? error.details : {}),
    },
  };
}

/**
 * Writes a command failure. JSON callers receive one parseable envelope on
 * stdout and no unstructured stderr text; text callers receive the message,
 * which already lists any structured issues.
 */
export function writeCommandError(
  io: CliIo,
  error: unknown,
  options: { json: boolean; prefix?: string },
): void {
  if (options.json) {
    io.stdout(`${JSON.stringify(commandErrorEnvelope(error), null, 2)}\n`);
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  io.stderr(`${options.prefix ?? ""}${message}\n`);
}
