import {
  validateSchema,
  type VerificationCommandResult,
  type VerificationResult,
  type VerificationSuite,
} from "@lervo/schemas";

import {
  calculateVerificationId,
  verificationCommandDigest,
  verificationSuiteHash,
} from "./integrity.js";
import { validateVerificationSuite } from "./suite-validation.js";
import { VerificationError } from "./types.js";

function invalidResult(message: string): never {
  throw new VerificationError("result_contract_invalid", message);
}

function timestamp(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) invalidResult("The verification result time is invalid.");
  return milliseconds;
}

function validateArtifact(
  artifact: NonNullable<VerificationCommandResult["stdoutArtifact"]>,
): void {
  const digest = artifact.contentHash.slice("sha256:".length);
  if (artifact.artifactId !== `art_${digest}` || artifact.uri !== `lervo-cas://sha256/${digest}`) {
    invalidResult("The verification output artifact coordinates do not match the content hash.");
  }
}

function expectedFailureCode(
  result: VerificationCommandResult,
): VerificationCommandResult["failureCode"] {
  if (result.status === "passed") return null;
  if (result.status === "failed") return "nonzero_exit";
  if (result.status === "timed_out") return "timeout";
  if (result.status === "output_limit_exceeded") return "output_limit_exceeded";
  if (result.status === "execution_error") return "execution_failed";
  if (result.status === "cancelled") return "cancelled";
  return result.failureCode;
}

function validateCommandResult(result: VerificationCommandResult): void {
  if (result.status === "not_run") {
    if (
      result.exitCode !== null ||
      result.startedAt !== null ||
      result.completedAt !== null ||
      result.durationMs !== null ||
      result.stdoutArtifact !== null ||
      result.stderrArtifact !== null ||
      (result.failureCode !== "blocked_by_previous_failure" && result.failureCode !== "cancelled")
    ) {
      invalidResult(
        "A verification command that was not run has execution evidence or lacks a reason.",
      );
    }
    return;
  }
  if (
    result.startedAt === null ||
    result.completedAt === null ||
    result.durationMs === null ||
    result.stdoutArtifact === null ||
    result.stderrArtifact === null
  ) {
    invalidResult("A completed verification command is missing times or an output artifact.");
  }
  if (timestamp(result.completedAt) < timestamp(result.startedAt)) {
    invalidResult("A verification command cannot complete before it starts.");
  }
  validateArtifact(result.stdoutArtifact);
  validateArtifact(result.stderrArtifact);
  if (
    result.failureCode !== expectedFailureCode(result) ||
    (result.status === "passed" && result.exitCode !== 0) ||
    (result.status === "failed" && (result.exitCode === null || result.exitCode === 0))
  ) {
    invalidResult(
      "The verification command status is inconsistent with its exit code or failure reason.",
    );
  }
}

function expectedOverallStatus(
  commands: readonly VerificationCommandResult[],
): VerificationResult["status"] {
  if (
    commands.some(
      (command) =>
        command.status === "cancelled" ||
        (command.status === "not_run" && command.failureCode === "cancelled"),
    )
  )
    return "cancelled";
  return commands.every((command) => command.status === "passed") ? "passed" : "failed";
}

export function validateVerificationResult(
  value: unknown,
  suite: VerificationSuite,
): asserts value is VerificationResult {
  if (!validateSchema("verificationResult", value).valid) {
    invalidResult("The verification result does not satisfy its schema.");
  }
  validateVerificationSuite(suite);
  const result = value as VerificationResult;
  const suiteStarted = timestamp(result.startedAt);
  const suiteCompleted = timestamp(result.completedAt);
  if (suiteCompleted < suiteStarted) {
    invalidResult("Verification cannot complete before it starts.");
  }
  if (
    result.suiteId !== suite.suiteId ||
    result.suiteHash !== verificationSuiteHash(suite) ||
    result.commands.length !== suite.commands.length
  ) {
    invalidResult("The verification result does not match the executed suite.");
  }
  for (let index = 0; index < result.commands.length; index += 1) {
    const command = suite.commands[index]!;
    const commandResult = result.commands[index]!;
    if (
      commandResult.commandId !== command.commandId ||
      commandResult.commandDigest !== verificationCommandDigest(command)
    ) {
      invalidResult("The verification command result order or digest differs from the suite.");
    }
    validateCommandResult(commandResult);
    if (
      commandResult.startedAt !== null &&
      (timestamp(commandResult.startedAt) < suiteStarted ||
        timestamp(commandResult.completedAt!) > suiteCompleted)
    ) {
      invalidResult("A verification command time falls outside the suite execution interval.");
    }
  }
  if (
    result.status !== expectedOverallStatus(result.commands) ||
    result.verificationId !== calculateVerificationId(result)
  ) {
    invalidResult(
      "The overall verification status or result ID differs from the command evidence.",
    );
  }
}
