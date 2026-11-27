import { execFile, spawn } from "node:child_process";
import { delimiter, dirname, resolve } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";

import {
  RepositoryWorkExecutionError,
  RepositoryWorkProgressDeadline,
  type RepositoryWorkTurnExecutor,
  type RepositoryWorkTurnRequest,
} from "@lervo/adapter-contract";

import { codexRepositoryWorkUsage, codexTurnCompletedUsage } from "./repository-work-usage.js";

const MAXIMUM_OUTPUT_BYTES = 64 * 1024 * 1024;
const executeFile = promisify(execFile);

interface CodexJsonEvent {
  type?: unknown;
  thread_id?: unknown;
  item?: { type?: unknown; text?: unknown };
  message?: unknown;
  usage?: unknown;
}

export class CodexRepositoryWorkTurnExecutor implements RepositoryWorkTurnExecutor {
  readonly provider = "codex" as const;

  constructor(private readonly executable = "codex") {}

  async execute(request: RepositoryWorkTurnRequest) {
    const args = this.arguments(request, await gitCommonDirectory(request.repositoryRoot));
    const output = await runCodexProcess({
      executable: this.executable,
      args,
      cwd: request.repositoryRoot,
      stdin: request.instructions,
      timeoutMs: request.timeoutMs,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
    });
    return parseCodexResult(output, request.providerSessionId);
  }

  private arguments(request: RepositoryWorkTurnRequest, gitDirectory: string | null): string[] {
    const model = request.model === undefined ? [] : ["--model", request.model];
    const effort =
      request.reasoningEffort === undefined
        ? []
        : ["--config", `model_reasoning_effort=${JSON.stringify(request.reasoningEffort)}`];
    const externalEffects =
      request.externalEffectsAuthorized === true
        ? ["--config", "sandbox_workspace_write.network_access=true"]
        : [];
    const repositoryMetadata = gitDirectory === null ? [] : ["--add-dir", gitDirectory];
    if (request.providerSessionId !== null) {
      return [
        "exec",
        ...repositoryMetadata,
        "resume",
        "--json",
        ...model,
        ...effort,
        ...externalEffects,
        request.providerSessionId,
        "-",
      ];
    }
    return [
      "exec",
      "--json",
      "--approve-for-me",
      "--cd",
      request.repositoryRoot,
      ...repositoryMetadata,
      ...model,
      ...effort,
      ...externalEffects,
      "-",
    ];
  }
}

async function gitCommonDirectory(repositoryRoot: string): Promise<string | null> {
  try {
    const { stdout } = await executeFile(
      "git",
      ["-C", repositoryRoot, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", maxBuffer: 16_384 },
    );
    const path = stdout.trim();
    return path.length > 0 && !path.includes("\0") && !path.includes("\n") ? resolve(path) : null;
  } catch {
    return null;
  }
}

function runCodexProcess(input: {
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
    // A turn whose prompt the provider closed before reading in full answered another request.
    let promptCutShort = false;
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
          const event = JSON.parse(line) as CodexJsonEvent;
          if (
            event.type === "thread.started" ||
            event.type === "turn.started" ||
            event.type === "item.started" ||
            event.type === "item.completed" ||
            event.type === "turn.completed"
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
            "The Codex repository-work process could not start.",
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
              "The Codex repository-work turn exceeded its execution deadline.",
            ),
          );
          return;
        }
        if (bytes > MAXIMUM_OUTPUT_BYTES || code !== 0 || promptCutShort) {
          reject(
            new RepositoryWorkExecutionError(
              code === null ? "provider_process_failed" : "provider_turn_failed",
              "The Codex repository-work turn failed.",
            ),
          );
          return;
        }
        resolve(Buffer.concat(stdout).toString("utf8"));
      }),
    );
    child.stdin.on("error", () => {
      promptCutShort = true;
    });
    child.stdin.end(input.stdin);
  });
}

function parseCodexResult(output: string, previousSessionId: string | null) {
  let providerSessionId = previousSessionId;
  let response: string | null = null;
  let usage: ReturnType<typeof codexTurnCompletedUsage> = null;
  for (const line of output.split("\n")) {
    if (line.trim().length === 0) continue;
    let event: CodexJsonEvent;
    try {
      event = JSON.parse(line) as CodexJsonEvent;
    } catch (error) {
      throw new RepositoryWorkExecutionError(
        "provider_protocol_failed",
        "The Codex repository-work stream contained invalid JSON.",
        { cause: error },
      );
    }
    if (event.type === "thread.started" && typeof event.thread_id === "string") {
      providerSessionId = event.thread_id;
    }
    if (
      event.type === "item.completed" &&
      event.item?.type === "agent_message" &&
      typeof event.item.text === "string"
    ) {
      response = event.item.text;
    }
    if (event.type === "turn.completed") usage = codexTurnCompletedUsage(event.usage);
    if (event.type === "error" && typeof event.message === "string") {
      throw new RepositoryWorkExecutionError("provider_turn_failed", event.message);
    }
  }
  if (providerSessionId === null || response === null || response.trim().length === 0) {
    throw new RepositoryWorkExecutionError(
      "provider_result_failed",
      "The Codex repository-work turn returned no resumable session or final response.",
    );
  }
  return {
    provider: "codex" as const,
    providerSessionId,
    response,
    completedAt: new Date().toISOString(),
    usage: codexRepositoryWorkUsage(usage),
  };
}
