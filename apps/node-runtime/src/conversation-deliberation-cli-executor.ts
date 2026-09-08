import { spawn } from "node:child_process";

import type {
  ConversationDeliberationExecutionPort,
  ConversationDeliberationJob,
  ConversationDeliberationResumeExecutionPort,
  ConversationDeliberationResumeJob,
  ConversationDeliberationSummary,
} from "@lervo/conversation-control";

interface CliProcessRequest {
  executable: string;
  args: string[];
  stdin: string;
  timeoutMs: number;
}

interface CliProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ConversationDeliberationCliProcess {
  run(request: CliProcessRequest): Promise<CliProcessResult>;
}

const MAXIMUM_OUTPUT_BYTES = 1_048_576;

const systemProcess: ConversationDeliberationCliProcess = {
  run(request) {
    return new Promise((resolve, reject) => {
      const child = spawn(request.executable, request.args, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let byteCount = 0;
      let settled = false;
      const timeout = setTimeout(() => child.kill("SIGKILL"), request.timeoutMs);
      const collect = (target: Buffer[], chunk: Buffer) => {
        byteCount += chunk.byteLength;
        if (byteCount > MAXIMUM_OUTPUT_BYTES) child.kill("SIGKILL");
        else target.push(chunk);
      };
      child.stdout.on("data", (chunk: Buffer) => collect(stdout, chunk));
      child.stderr.on("data", (chunk: Buffer) => collect(stderr, chunk));
      child.once("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(error);
      });
      child.once("close", (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (byteCount > MAXIMUM_OUTPUT_BYTES || exitCode === null) {
          reject(new Error("The assigned deliberation process did not finish within its bounds."));
          return;
        }
        resolve({
          exitCode,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
      child.stdin.end(request.stdin);
    });
  },
};

function parseSummary(
  result: CliProcessResult,
  expectedId: string,
): ConversationDeliberationSummary {
  if (![0, 2].includes(result.exitCode)) {
    throw new Error("The assigned deliberation process failed.");
  }
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error("The assigned deliberation process returned unreadable output.", {
      cause: error,
    });
  }
  const summary = value as {
    schemaVersion?: unknown;
    deliberationId?: unknown;
    status?: unknown;
    artifactCount?: unknown;
  };
  if (
    summary.schemaVersion !== 1 ||
    summary.deliberationId !== expectedId ||
    !["converged", "no_consensus"].includes(String(summary.status)) ||
    !Number.isSafeInteger(summary.artifactCount) ||
    Number(summary.artifactCount) < 0 ||
    Number(summary.artifactCount) > 10_000
  ) {
    throw new Error("The assigned deliberation process returned invalid evidence.");
  }
  return {
    deliberationId: expectedId,
    status: summary.status as "converged" | "no_consensus",
    artifactCount: summary.artifactCount as number,
    nextAction: "none",
  };
}

function execute(
  options: {
    executable: string;
    repositoryRoot: string;
    processTimeoutMs?: number;
    process?: ConversationDeliberationCliProcess;
  },
  job: Readonly<ConversationDeliberationJob | ConversationDeliberationResumeJob>,
): Promise<ConversationDeliberationSummary> {
  const operation = job.operation;
  const stdin =
    operation === "start"
      ? JSON.stringify({ operation, policyId: job.policyId, topic: job.topic })
      : JSON.stringify({ operation });
  return (options.process ?? systemProcess)
    .run({
      executable: options.executable,
      args: [
        "deliberate",
        "assigned-worker",
        "--deliberation-id",
        job.deliberationId,
        "--project-id",
        job.projectId,
        "--root",
        options.repositoryRoot,
        "--stdin",
      ],
      stdin,
      timeoutMs: options.processTimeoutMs ?? 900_000,
    })
    .then((result) => parseSummary(result, job.deliberationId));
}

export function createConversationDeliberationCliExecutionPorts(options: {
  executable: string;
  repositoryRoot: string;
  processTimeoutMs?: number;
  process?: ConversationDeliberationCliProcess;
}): {
  start: ConversationDeliberationExecutionPort;
  resume: ConversationDeliberationResumeExecutionPort;
} {
  return {
    start: { execute: (job) => execute(options, job) },
    resume: { execute: (job) => execute(options, job) },
  };
}
