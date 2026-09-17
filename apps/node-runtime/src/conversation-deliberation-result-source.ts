import { createHash } from "node:crypto";

import {
  maximumConversationDeliberationCliOutputBytes,
  systemConversationDeliberationCliProcess,
  type ConversationDeliberationCliProcess,
} from "./conversation-deliberation-cli-executor.js";

export interface ConversationDeliberationPublishedResult {
  status: "interrupted" | "converged" | "no_consensus" | "failed";
  content: string | null;
}

export interface ConversationDeliberationResultSource {
  read(input: {
    projectId: string;
    deliberationId: string;
  }): Promise<ConversationDeliberationPublishedResult>;
}

type CliProcessResult = Awaited<ReturnType<ConversationDeliberationCliProcess["run"]>>;

function parseResultCoordinates(
  result: CliProcessResult,
  expectedProjectId: string,
  expectedDeliberationId: string,
): { status: ConversationDeliberationPublishedResult["status"]; contentHash: string | null } {
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error("The deliberation result inspection process failed.");
  }
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error("The deliberation result inspection returned unreadable output.", {
      cause: error,
    });
  }
  const report = value as {
    schemaVersion?: unknown;
    projectId?: unknown;
    deliberationId?: unknown;
    sourceStatus?: unknown;
    phase?: unknown;
    completionStatus?: unknown;
    events?: unknown;
  };
  if (
    report.schemaVersion !== 1 ||
    report.projectId !== expectedProjectId ||
    report.deliberationId !== expectedDeliberationId ||
    report.sourceStatus !== "consistent" ||
    report.phase !== "completed" ||
    !["converged", "no_consensus", "failed"].includes(String(report.completionStatus)) ||
    !Array.isArray(report.events) ||
    report.events.length > 1_000
  ) {
    throw new Error("The deliberation result inspection did not prove a terminal result.");
  }
  const status = report.completionStatus as "converged" | "no_consensus" | "failed";
  if (status === "failed") return { status, contentHash: null };
  const completed = report.events.filter(
    (event): event is { type: string; payload: Record<string, unknown> } =>
      typeof event === "object" &&
      event !== null &&
      (event as { type?: unknown }).type === "deliberation.completed" &&
      typeof (event as { payload?: unknown }).payload === "object" &&
      (event as { payload?: unknown }).payload !== null,
  );
  const artifacts = report.events.filter(
    (event): event is { seq: number; type: string; payload: Record<string, unknown> } =>
      typeof event === "object" &&
      event !== null &&
      Number.isSafeInteger((event as { seq?: unknown }).seq) &&
      (event as { type?: unknown }).type === "deliberation.artifact.recorded" &&
      typeof (event as { payload?: unknown }).payload === "object" &&
      (event as { payload?: unknown }).payload !== null,
  );
  if (completed.length !== 1 || artifacts.length === 0) {
    throw new Error("The deliberation result history is incomplete.");
  }
  const decisionArtifactId = completed[0]!.payload.decisionArtifactId;
  const selected =
    status === "converged"
      ? artifacts.find((event) => event.payload.deliberationArtifactId === decisionArtifactId)
      : artifacts.toSorted((left, right) => right.seq - left.seq)[0];
  const contentHash = selected?.payload.contentHash;
  if (
    (status === "converged" && selected?.payload.kind !== "decision") ||
    (status === "no_consensus" && selected?.payload.kind !== "objection") ||
    typeof contentHash !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(contentHash)
  ) {
    throw new Error("The deliberation result artifact coordinate is invalid.");
  }
  return { status, contentHash };
}

function parseResultContent(result: CliProcessResult, expectedContentHash: string): string {
  if (result.exitCode !== 0) throw new Error("The deliberation result artifact could not be read.");
  let value: unknown;
  try {
    value = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error("The deliberation result artifact returned unreadable output.", {
      cause: error,
    });
  }
  const recovered = value as {
    schemaVersion?: unknown;
    contentHash?: unknown;
    recoveryStatus?: unknown;
    content?: unknown;
  };
  if (
    recovered.schemaVersion !== 1 ||
    recovered.contentHash !== expectedContentHash ||
    recovered.recoveryStatus !== "recovered" ||
    typeof recovered.content !== "string" ||
    recovered.content.length === 0 ||
    Buffer.byteLength(recovered.content, "utf8") > maximumConversationDeliberationCliOutputBytes ||
    `sha256:${createHash("sha256").update(recovered.content).digest("hex")}` !== expectedContentHash
  ) {
    throw new Error("The deliberation result artifact evidence is invalid.");
  }
  return recovered.content.trim();
}

export function createConversationDeliberationResultSource(options: {
  executable: string;
  repositoryRoot: string;
  processTimeoutMs?: number;
  process?: ConversationDeliberationCliProcess;
}): ConversationDeliberationResultSource {
  const process = options.process ?? systemConversationDeliberationCliProcess;
  const timeoutMs = Math.min(options.processTimeoutMs ?? 3_600_000, 60_000);
  return {
    async read(input) {
      const inspection = await process.run({
        executable: options.executable,
        args: [
          "deliberate",
          "status",
          input.deliberationId,
          "--root",
          options.repositoryRoot,
          "--json",
        ],
        stdin: "",
        timeoutMs,
      });
      const coordinate = parseResultCoordinates(inspection, input.projectId, input.deliberationId);
      if (coordinate.contentHash === null) {
        return { status: coordinate.status, content: null };
      }
      const artifact = await process.run({
        executable: options.executable,
        args: [
          "deliberate",
          "artifact",
          "--content-hash",
          coordinate.contentHash,
          "--root",
          options.repositoryRoot,
          "--json",
        ],
        stdin: "",
        timeoutMs,
      });
      return {
        status: coordinate.status,
        content: parseResultContent(artifact, coordinate.contentHash),
      };
    },
  };
}
