import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { delimiter, dirname } from "node:path";

import {
  RepositoryWorkExecutionError,
  type RepositoryWorkTurnExecutor,
  type RepositoryWorkTurnRequest,
} from "@lervo/adapter-contract";

const MAXIMUM_OUTPUT_BYTES = 16 * 1024 * 1024;

interface ClaudeJsonResult {
  is_error?: unknown;
  session_id?: unknown;
  result?: unknown;
  errors?: unknown;
}

export class ClaudeRepositoryWorkTurnExecutor implements RepositoryWorkTurnExecutor {
  readonly provider = "claude" as const;

  constructor(private readonly executable = "claude") {}

  async execute(request: RepositoryWorkTurnRequest) {
    const sessionId = request.providerSessionId ?? randomUUID();
    const output = await runClaudeProcess({
      executable: this.executable,
      args: this.arguments(request, sessionId),
      cwd: request.repositoryRoot,
      stdin: request.instructions,
      timeoutMs: request.timeoutMs,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return parseClaudeResult(output, sessionId);
  }

  private arguments(request: RepositoryWorkTurnRequest, sessionId: string): string[] {
    return [
      "--print",
      "--output-format",
      "json",
      "--permission-mode",
      request.externalEffectsAuthorized === true ? "bypassPermissions" : "auto",
      ...(request.providerSessionId === null
        ? ["--session-id", sessionId]
        : ["--resume", sessionId]),
      ...(request.model === undefined ? [] : ["--model", request.model]),
      ...(request.reasoningEffort === undefined ? [] : ["--effort", request.reasoningEffort]),
      "-",
    ];
  }
}

function runClaudeProcess(input: {
  executable: string;
  args: string[];
  cwd: string;
  stdin: string;
  timeoutMs: number;
  signal?: AbortSignal;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(input.executable, input.args, {
      cwd: input.cwd,
      env: {
        ...process.env,
        PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
      },
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    let timedOut = false;
    let forcedTermination: ReturnType<typeof setTimeout> | undefined;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forcedTermination !== undefined) clearTimeout(forcedTermination);
      input.signal?.removeEventListener("abort", abort);
      operation();
    };
    const abort = () => child.kill("SIGTERM");
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      forcedTermination = setTimeout(() => child.kill("SIGKILL"), 5_000);
      forcedTermination.unref?.();
    }, input.timeoutMs);
    timer.unref?.();
    input.signal?.addEventListener("abort", abort, { once: true });
    const collect = (target: Buffer[] | null, chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > MAXIMUM_OUTPUT_BYTES) child.kill("SIGTERM");
      else target?.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
    child.stderr.on("data", (chunk: Buffer) => collect(null, chunk));
    child.once("error", (error) =>
      finish(() =>
        reject(
          new RepositoryWorkExecutionError(
            "provider_process_failed",
            "The Claude repository-work process could not start.",
            { cause: error },
          ),
        ),
      ),
    );
    child.once("close", (code) =>
      finish(() => {
        if (timedOut) {
          reject(
            new RepositoryWorkExecutionError(
              "provider_turn_timeout",
              "The Claude repository-work turn exceeded its execution deadline.",
            ),
          );
          return;
        }
        if (bytes > MAXIMUM_OUTPUT_BYTES || code !== 0) {
          reject(
            new RepositoryWorkExecutionError(
              code === null ? "provider_process_failed" : "provider_turn_failed",
              "The Claude repository-work turn failed.",
            ),
          );
          return;
        }
        resolve(Buffer.concat(stdout).toString("utf8"));
      }),
    );
    child.stdin.end(input.stdin);
  });
}

function parseClaudeResult(output: string, expectedSessionId: string) {
  let result: ClaudeJsonResult;
  try {
    result = JSON.parse(output) as ClaudeJsonResult;
  } catch (error) {
    throw new RepositoryWorkExecutionError(
      "provider_protocol_failed",
      "The Claude repository-work process returned invalid JSON.",
      { cause: error },
    );
  }
  if (result.session_id !== expectedSessionId) {
    throw new RepositoryWorkExecutionError(
      "provider_protocol_failed",
      "The Claude repository-work result changed its session identity.",
    );
  }
  if (result.is_error === true) {
    const errors = Array.isArray(result.errors)
      ? result.errors.filter((value): value is string => typeof value === "string").join("; ")
      : "";
    throw new RepositoryWorkExecutionError(
      "provider_turn_failed",
      errors.length === 0 ? "The Claude repository-work turn failed." : errors.slice(0, 2_000),
    );
  }
  if (typeof result.result !== "string" || result.result.trim().length === 0) {
    throw new RepositoryWorkExecutionError(
      "provider_result_failed",
      "The Claude repository-work turn returned no final response.",
    );
  }
  return {
    provider: "claude" as const,
    providerSessionId: expectedSessionId,
    response: result.result,
    completedAt: new Date().toISOString(),
  };
}
