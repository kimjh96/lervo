import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { delimiter, dirname } from "node:path";
import { StringDecoder } from "node:string_decoder";

import {
  RepositoryWorkExecutionError,
  RepositoryWorkProgressDeadline,
  type RepositoryWorkTurnExecutor,
  type RepositoryWorkTurnRequest,
} from "@lervo/adapter-contract";

import { readClaudeSessionFinal } from "./repository-work-session-final.js";
import { claudeRepositoryWorkUsage } from "./repository-work-usage.js";

const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;

interface ClaudeJsonResult {
  is_error?: unknown;
  session_id?: unknown;
  result?: unknown;
  errors?: unknown;
  subtype?: unknown;
  usage?: unknown;
  modelUsage?: unknown;
}

export class ClaudeRepositoryWorkTurnExecutor implements RepositoryWorkTurnExecutor {
  readonly provider = "claude" as const;

  constructor(
    private readonly executable = "claude",
    private readonly claudeConfigDirectory?: string,
  ) {}

  async execute(request: RepositoryWorkTurnRequest) {
    const sessionId = request.providerSessionId ?? randomUUID();
    const processResult = await runClaudeProcess({
      executable: this.executable,
      args: this.arguments(request, sessionId),
      cwd: request.repositoryRoot,
      stdin: request.instructions,
      timeoutMs: request.timeoutMs,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return parseClaudeResult(processResult, sessionId, {
      repositoryRoot: request.repositoryRoot,
      ...(this.claudeConfigDirectory === undefined
        ? {}
        : { claudeConfigDirectory: this.claudeConfigDirectory }),
    });
  }

  private arguments(request: RepositoryWorkTurnRequest, sessionId: string): string[] {
    return [
      "--print",
      "--verbose",
      "--output-format",
      "stream-json",
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
}): Promise<{ output: string; startedAtMs: number; completedAtMs: number }> {
  return new Promise((resolve, reject) => {
    const startedAtMs = Date.now();
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
    const progressDecoder = new StringDecoder("utf8");
    let pendingProgressLine = "";
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      deadline.close();
      if (forcedTermination !== undefined) clearTimeout(forcedTermination);
      input.signal?.removeEventListener("abort", abort);
      operation();
    };
    const abort = () => child.kill("SIGTERM");
    const deadline = new RepositoryWorkProgressDeadline(input.timeoutMs, () => {
      timedOut = true;
      child.kill("SIGTERM");
      forcedTermination = setTimeout(() => child.kill("SIGKILL"), 5_000);
      forcedTermination.unref?.();
    });
    input.signal?.addEventListener("abort", abort, { once: true });
    if (input.signal?.aborted) abort();
    const observeProgress = (chunk: Buffer) => {
      pendingProgressLine += progressDecoder.write(chunk);
      let newline = pendingProgressLine.indexOf("\n");
      while (newline >= 0) {
        const line = pendingProgressLine.slice(0, newline);
        pendingProgressLine = pendingProgressLine.slice(newline + 1);
        try {
          const event = JSON.parse(line) as { type?: unknown };
          if (
            event.type === "system" ||
            event.type === "assistant" ||
            event.type === "user" ||
            event.type === "result"
          ) {
            deadline.observeProgress();
          }
        } catch {
          // The final protocol parser owns malformed-output failures.
        }
        newline = pendingProgressLine.indexOf("\n");
      }
    };
    const collect = (target: Buffer[] | null, chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > MAXIMUM_OUTPUT_BYTES) child.kill("SIGTERM");
      else target?.push(chunk);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      collect(stdout, chunk);
      if (bytes <= MAXIMUM_OUTPUT_BYTES) observeProgress(chunk);
    });
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
        resolve({
          output: Buffer.concat(stdout).toString("utf8"),
          startedAtMs,
          completedAtMs: Date.now(),
        });
      }),
    );
    child.stdin.end(input.stdin);
  });
}

async function parseClaudeResult(
  processResult: { output: string; startedAtMs: number; completedAtMs: number },
  expectedSessionId: string,
  input: { repositoryRoot: string; claudeConfigDirectory?: string },
) {
  let result: ClaudeJsonResult | undefined;
  let finalAssistantText: string | null = null;
  try {
    for (const line of processResult.output.split("\n")) {
      if (line.trim().length === 0) continue;
      const event = JSON.parse(line) as ClaudeJsonResult & {
        type?: unknown;
        message?: unknown;
      };
      if (event.type === "result" || event.type === undefined) {
        result = event;
        break;
      }
      if (event.type === "user") {
        const message = event.message;
        const content =
          typeof message === "object" && message !== null && "content" in message
            ? message.content
            : null;
        if (!Array.isArray(content) || !content.every((block) => block?.type === "tool_result")) {
          finalAssistantText = null;
        }
      } else if (event.type === "assistant") {
        const message = event.message;
        const content =
          typeof message === "object" && message !== null && "content" in message
            ? message.content
            : null;
        if (!Array.isArray(content) || content.some((block) => block?.type === "tool_use")) {
          finalAssistantText = null;
          continue;
        }
        const text = content
          .filter((block) => block?.type === "text" && typeof block.text === "string")
          .map((block) => block.text as string)
          .join("\n")
          .trim();
        finalAssistantText = text.length === 0 ? null : text;
      }
    }
  } catch (error) {
    throw new RepositoryWorkExecutionError(
      "provider_protocol_failed",
      "The Claude repository-work process returned invalid JSON.",
      { cause: error },
    );
  }
  if (result?.session_id !== expectedSessionId) {
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
  const streamedResponse =
    typeof result.result === "string" && result.result.trim().length > 0
      ? result.result
      : result.subtype === "success" && result.is_error === false
        ? finalAssistantText
        : null;
  const response =
    streamedResponse ??
    (result.subtype === "success" && result.is_error === false
      ? await readClaudeSessionFinal({
          sessionId: expectedSessionId,
          repositoryRoot: input.repositoryRoot,
          startedAtMs: processResult.startedAtMs,
          completedAtMs: processResult.completedAtMs,
          ...(input.claudeConfigDirectory === undefined
            ? {}
            : { configDirectory: input.claudeConfigDirectory }),
        })
      : null);
  if (response === null) {
    throw new RepositoryWorkExecutionError(
      "provider_result_failed",
      "The Claude repository-work turn returned no final response.",
    );
  }
  return {
    provider: "claude" as const,
    providerSessionId: expectedSessionId,
    response,
    completedAt: new Date().toISOString(),
    usage: claudeRepositoryWorkUsage(result),
  };
}
