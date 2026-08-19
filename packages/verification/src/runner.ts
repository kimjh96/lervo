import { canonicalJson } from "@lervo/event-contract";
import {
  type VerificationCommand,
  type VerificationCommandResult,
  type VerificationResult,
} from "@lervo/schemas";

import { storeVerificationBytes } from "./artifact.js";
import { executeVerificationCommand } from "./command-executor.js";
import {
  calculateVerificationId,
  verificationCommandDigest,
  verificationResultBytes,
  verificationSuiteHash,
} from "./integrity.js";
import { validateVerificationResult } from "./result-validation.js";
import {
  VerificationError,
  type RunVerificationSuiteInput,
  type RunVerificationSuiteOptions,
  type RunVerificationSuiteResult,
} from "./types.js";
import {
  resolveVerificationWorkingDirectories,
  validateRepositoryRevision,
  validateVerificationSuite,
} from "./validation.js";

function notRunResult(
  command: VerificationCommand,
  failureCode: "blocked_by_previous_failure" | "cancelled",
): VerificationCommandResult {
  return {
    commandId: command.commandId,
    commandDigest: verificationCommandDigest(command),
    status: "not_run",
    exitCode: null,
    startedAt: null,
    completedAt: null,
    durationMs: null,
    stdoutArtifact: null,
    stderrArtifact: null,
    failureCode,
  };
}

function failureCode(status: Exclude<VerificationCommandResult["status"], "not_run">) {
  if (status === "passed") return null;
  if (status === "failed") return "nonzero_exit" as const;
  if (status === "timed_out") return "timeout" as const;
  if (status === "output_limit_exceeded") return "output_limit_exceeded" as const;
  if (status === "cancelled") return "cancelled" as const;
  return "execution_failed" as const;
}

function validClock(now: () => Date): Date {
  const value = now();
  if (Number.isNaN(value.getTime())) {
    throw new VerificationError("invalid_verification_request", "Verification clock이 유효하지 않습니다.");
  }
  return value;
}

async function captureRevision(input: RunVerificationSuiteInput): Promise<string> {
  try {
    const revision = await input.captureRepositoryRevision(input.repositoryRoot);
    validateRepositoryRevision(revision);
    return revision;
  } catch (error) {
    throw new VerificationError(
      "repository_snapshot_failed",
      "Verification repository snapshot을 안전하게 수집하지 못했습니다.",
      { cause: error },
    );
  }
}

export async function runVerificationSuite(
  input: RunVerificationSuiteInput,
  options: RunVerificationSuiteOptions = {},
): Promise<RunVerificationSuiteResult> {
  validateVerificationSuite(input.suite);
  validateRepositoryRevision(input.repositoryRevision);
  const workingDirectories = await resolveVerificationWorkingDirectories(
    input.repositoryRoot,
    input.suite,
  );
  const beforeRevision = await captureRevision(input);
  if (beforeRevision !== input.repositoryRevision) {
    throw new VerificationError(
      "repository_snapshot_mismatch",
      "Verification 요청 revision이 실행 직전 repository snapshot과 다릅니다.",
    );
  }
  const now = options.now ?? (() => new Date());
  const environment = options.environment ?? process.env;
  const startedAt = validClock(now);
  const commands: VerificationCommandResult[] = [];
  let blockedBy: "failure" | "cancelled" | null = input.signal?.aborted ? "cancelled" : null;

  for (const command of input.suite.commands) {
    if (blockedBy !== null) {
      commands.push(notRunResult(
        command,
        blockedBy === "cancelled" ? "cancelled" : "blocked_by_previous_failure",
      ));
      continue;
    }
    const raw = await executeVerificationCommand({
      command,
      cwd: workingDirectories.get(command.commandId)!,
      now: () => validClock(now),
      environment,
      ...(input.signal === undefined ? {} : { signal: input.signal }),
    });
    const stdoutArtifact = await storeVerificationBytes(input.artifactStore, raw.stdout);
    const stderrArtifact = await storeVerificationBytes(input.artifactStore, raw.stderr);
    commands.push({
      commandId: command.commandId,
      commandDigest: verificationCommandDigest(command),
      status: raw.status,
      exitCode: raw.exitCode,
      startedAt: raw.startedAt,
      completedAt: raw.completedAt,
      durationMs: raw.durationMs,
      stdoutArtifact,
      stderrArtifact,
      failureCode: failureCode(raw.status),
    });
    if (raw.status !== "passed") {
      blockedBy = raw.status === "cancelled" ? "cancelled" : "failure";
    }
  }

  const completedAt = validClock(now);
  if (completedAt.getTime() < startedAt.getTime()) {
    throw new VerificationError("invalid_verification_request", "Verification 완료 시각이 시작 시각보다 이를 수 없습니다.");
  }
  const afterRevision = await captureRevision(input);
  if (afterRevision !== beforeRevision) {
    throw new VerificationError(
      "repository_changed_during_verification",
      "Verification 명령 실행 중 repository snapshot이 바뀌었습니다.",
    );
  }
  const status = commands.some((command) =>
    command.status === "cancelled" ||
    (command.status === "not_run" && command.failureCode === "cancelled")
  ) ? "cancelled" : commands.every((command) => command.status === "passed") ? "passed" : "failed";
  const resultContent: Omit<VerificationResult, "verificationId"> = {
    schemaVersion: 1,
    suiteId: input.suite.suiteId,
    suiteHash: verificationSuiteHash(input.suite),
    repositoryRevision: input.repositoryRevision,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    status,
    commands,
  };
  const result: VerificationResult = {
    ...resultContent,
    verificationId: calculateVerificationId(resultContent),
  };
  validateVerificationResult(result, input.suite);
  const resultArtifact = await storeVerificationBytes(
    input.artifactStore,
    verificationResultBytes(result),
  );
  return {
    result: structuredClone(result),
    resultArtifact: {
      ...resultArtifact,
      mediaType: "application/vnd.lervo.verification-result+json; charset=utf-8",
    },
  };
}

export function verificationResultJson(result: VerificationResult): string {
  return canonicalJson(result);
}
