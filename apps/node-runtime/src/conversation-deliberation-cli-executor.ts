import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { delimiter, dirname } from "node:path";

import type {
  ConversationDeliberationExecutionPort,
  ConversationDeliberationJob,
  ConversationDeliberationResumeExecutionPort,
  ConversationDeliberationResumeJob,
  ConversationDeliberationSummary,
  ConversationDeliberationReconciliationSourcePort,
} from "@lervo/conversation-control";
import type { ConversationDeliberationParticipantAssignmentPort } from "./conversation-deliberation-participant-router.js";

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

export const maximumConversationDeliberationCliOutputBytes = 1_048_576;
export const conversationDeliberationProcessFinalizationReserveMs = 60_000;

export function conversationDeliberationManagedElapsedMs(processTimeoutMs: number): number {
  if (!Number.isSafeInteger(processTimeoutMs) || processTimeoutMs < 1_000) {
    throw new TypeError("The deliberation process timeout is invalid.");
  }
  return Math.max(1_000, processTimeoutMs - conversationDeliberationProcessFinalizationReserveMs);
}

export const systemConversationDeliberationCliProcess: ConversationDeliberationCliProcess = {
  run(request) {
    return new Promise((resolve, reject) => {
      const child = spawn(request.executable, request.args, {
        stdio: ["pipe", "pipe", "pipe"],
        shell: false,
        env: {
          ...process.env,
          PATH: [dirname(process.execPath), process.env.PATH].filter(Boolean).join(delimiter),
        },
      });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let byteCount = 0;
      let settled = false;
      const timeout = setTimeout(() => child.kill("SIGKILL"), request.timeoutMs);
      const collect = (target: Buffer[], chunk: Buffer) => {
        byteCount += chunk.byteLength;
        if (byteCount > maximumConversationDeliberationCliOutputBytes) child.kill("SIGKILL");
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
        if (byteCount > maximumConversationDeliberationCliOutputBytes || exitCode === null) {
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
    failureReasonCode?: unknown;
  };
  if (
    summary.schemaVersion !== 1 ||
    summary.deliberationId !== expectedId ||
    !["converged", "no_consensus", "failed"].includes(String(summary.status)) ||
    !Number.isSafeInteger(summary.artifactCount) ||
    Number(summary.artifactCount) < 0 ||
    Number(summary.artifactCount) > 10_000 ||
    (summary.failureReasonCode !== undefined &&
      summary.failureReasonCode !== null &&
      (typeof summary.failureReasonCode !== "string" ||
        !/^[a-z][a-z0-9_]{0,63}$/u.test(summary.failureReasonCode)))
  ) {
    throw new Error("The assigned deliberation process returned invalid evidence.");
  }
  return {
    deliberationId: expectedId,
    status: summary.status as "converged" | "no_consensus" | "failed",
    artifactCount: summary.artifactCount as number,
    nextAction: "none",
    ...(summary.failureReasonCode === undefined
      ? {}
      : { failureReasonCode: summary.failureReasonCode as string | null }),
  };
}

function execute(
  options: {
    executable: string;
    repositoryRoot: string;
    providerExecutables?: Partial<Record<"codex" | "claude", string>>;
    providerModels?: Partial<Record<"codex" | "claude", string>>;
    providerReasoningEfforts?: Partial<
      Record<"codex" | "claude", "low" | "medium" | "high" | "xhigh" | "max">
    >;
    processTimeoutMs?: number;
    process?: ConversationDeliberationCliProcess;
    participantAssignments?: ConversationDeliberationParticipantAssignmentPort;
  },
  job: Readonly<ConversationDeliberationJob | ConversationDeliberationResumeJob>,
): Promise<ConversationDeliberationSummary> {
  const operation = job.operation;
  const processTimeoutMs = options.processTimeoutMs ?? 3_600_000;
  const executionMaximumElapsedMs = conversationDeliberationManagedElapsedMs(processTimeoutMs);
  const acceptedAt = new Date().toISOString();
  const participantAssignments = options.participantAssignments?.assign({
    deliberationId: job.deliberationId,
    policyId: operation === "start" ? job.policyId : null,
    projectId: job.projectId,
    conversationId: operation === "start" ? (job.origin?.conversationId ?? null) : null,
    acceptedAt,
  });
  const stdin =
    operation === "start"
      ? JSON.stringify({
          operation,
          policyId: job.policyId,
          topic: job.topic,
          ...(job.origin === null
            ? {}
            : { origin: { sourceEventId: job.sourceEventId, ...job.origin } }),
          responseLanguage: /\p{Script=Hangul}/u.test(job.topic) ? "ko" : "en",
          executionMaximumElapsedMs,
          ...(participantAssignments === undefined ? {} : { participantAssignments }),
        })
      : JSON.stringify({
          operation,
          executionMaximumElapsedMs,
          ...(participantAssignments === undefined ? {} : { participantAssignments }),
        });
  return (options.process ?? systemConversationDeliberationCliProcess)
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
        ...(options.providerExecutables?.codex === undefined
          ? []
          : ["--codex-executable", options.providerExecutables.codex]),
        ...(options.providerExecutables?.claude === undefined
          ? []
          : ["--claude-executable", options.providerExecutables.claude]),
        ...(options.providerModels?.codex === undefined
          ? []
          : ["--codex-model", options.providerModels.codex]),
        ...(options.providerModels?.claude === undefined
          ? []
          : ["--claude-model", options.providerModels.claude]),
        ...(options.providerReasoningEfforts?.codex === undefined
          ? []
          : ["--codex-reasoning-effort", options.providerReasoningEfforts.codex]),
        ...(options.providerReasoningEfforts?.claude === undefined
          ? []
          : ["--claude-reasoning-effort", options.providerReasoningEfforts.claude]),
        "--stdin",
      ],
      stdin,
      timeoutMs: processTimeoutMs,
    })
    .then((result) => parseSummary(result, job.deliberationId));
}

function parseInspection(
  result: CliProcessResult,
  job: Parameters<ConversationDeliberationReconciliationSourcePort["inspect"]>[0]["job"],
): Awaited<ReturnType<ConversationDeliberationReconciliationSourcePort["inspect"]>> {
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    return { status: "not_confirmed", reason: "source_inconsistent" };
  }
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch {
    return { status: "not_confirmed", reason: "source_inconsistent" };
  }
  const report = value as Record<string, unknown>;
  if (report.projectId !== job.projectId || report.deliberationId !== job.deliberationId) {
    return { status: "not_confirmed", reason: "source_inconsistent" };
  }
  if (report.sourceStatus === "inconsistent") {
    return { status: "not_confirmed", reason: "source_inconsistent" };
  }
  if (report.sourceStatus === "incomplete") {
    return { status: "not_confirmed", reason: "history_incomplete" };
  }
  const artifactCount = report.artifactCount;
  if (
    !Number.isSafeInteger(artifactCount) ||
    Number(artifactCount) < 0 ||
    Number(artifactCount) > 10_000
  ) {
    return { status: "not_confirmed", reason: "source_inconsistent" };
  }
  const evidenceHash = `sha256:${createHash("sha256").update(result.stdout).digest("hex")}`;
  if (
    report.phase === "completed" &&
    ["converged", "no_consensus", "failed"].includes(String(report.completionStatus))
  ) {
    return {
      status: "confirmed",
      sourceKind: "managed_deliberation_cli_v1",
      evidenceHash,
      summary: {
        deliberationId: job.deliberationId,
        status: report.completionStatus as "converged" | "no_consensus" | "failed",
        artifactCount: artifactCount as number,
        nextAction: "none",
      },
    };
  }
  if (
    job.operation === "start" &&
    report.phase === "interrupted_after_approval" &&
    report.resume === "candidate" &&
    report.checkpoint === "readable" &&
    report.lease !== "active"
  ) {
    return {
      status: "confirmed",
      sourceKind: "managed_deliberation_cli_v1",
      evidenceHash,
      summary: {
        deliberationId: job.deliberationId,
        status: "interrupted",
        artifactCount: artifactCount as number,
        nextAction: "resume",
      },
    };
  }
  return {
    status: "not_confirmed",
    reason: report.lease === "active" ? "active_execution" : "history_incomplete",
  };
}

export function createConversationDeliberationCliExecutionPorts(options: {
  executable: string;
  repositoryRoot: string;
  providerExecutables?: Partial<Record<"codex" | "claude", string>>;
  providerModels?: Partial<Record<"codex" | "claude", string>>;
  providerReasoningEfforts?: Partial<
    Record<"codex" | "claude", "low" | "medium" | "high" | "xhigh" | "max">
  >;
  processTimeoutMs?: number;
  process?: ConversationDeliberationCliProcess;
  participantAssignments?: ConversationDeliberationParticipantAssignmentPort;
}): {
  start: ConversationDeliberationExecutionPort;
  resume: ConversationDeliberationResumeExecutionPort;
  reconciliation: ConversationDeliberationReconciliationSourcePort;
} {
  const process = options.process ?? systemConversationDeliberationCliProcess;
  return {
    start: { execute: (job) => execute(options, job) },
    resume: { execute: (job) => execute(options, job) },
    reconciliation: {
      async inspect(input) {
        let result: CliProcessResult;
        try {
          result = await process.run({
            executable: options.executable,
            args: [
              "deliberate",
              "status",
              input.job.deliberationId,
              "--root",
              options.repositoryRoot,
              "--json",
            ],
            stdin: "",
            timeoutMs: Math.min(options.processTimeoutMs ?? 3_600_000, 60_000),
          });
        } catch {
          return { status: "not_confirmed", reason: "source_inconsistent" };
        }
        return parseInspection(result, input.job);
      },
    },
  };
}
