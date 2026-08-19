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
  if (!Number.isFinite(milliseconds)) invalidResult("Verification result 시각이 유효하지 않습니다.");
  return milliseconds;
}

function validateArtifact(
  artifact: NonNullable<VerificationCommandResult["stdoutArtifact"]>,
): void {
  const digest = artifact.contentHash.slice("sha256:".length);
  if (
    artifact.artifactId !== `art_${digest}` ||
    artifact.uri !== `lervo-cas://sha256/${digest}`
  ) {
    invalidResult("Verification output artifact 좌표가 content hash와 다릅니다.");
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
      result.exitCode !== null || result.startedAt !== null || result.completedAt !== null ||
      result.durationMs !== null || result.stdoutArtifact !== null || result.stderrArtifact !== null ||
      (result.failureCode !== "blocked_by_previous_failure" && result.failureCode !== "cancelled")
    ) {
      invalidResult("실행하지 않은 verification command에 실행 증거가 있거나 사유가 없습니다.");
    }
    return;
  }
  if (
    result.startedAt === null || result.completedAt === null || result.durationMs === null ||
    result.stdoutArtifact === null || result.stderrArtifact === null
  ) {
    invalidResult("실행된 verification command의 시간 또는 output artifact가 없습니다.");
  }
  if (timestamp(result.completedAt) < timestamp(result.startedAt)) {
    invalidResult("Verification command 완료 시각이 시작 시각보다 이를 수 없습니다.");
  }
  validateArtifact(result.stdoutArtifact);
  validateArtifact(result.stderrArtifact);
  if (
    result.failureCode !== expectedFailureCode(result) ||
    (result.status === "passed" && result.exitCode !== 0) ||
    (result.status === "failed" && (result.exitCode === null || result.exitCode === 0))
  ) {
    invalidResult("Verification command 상태가 exit code 또는 실패 사유와 다릅니다.");
  }
}

function expectedOverallStatus(
  commands: readonly VerificationCommandResult[],
): VerificationResult["status"] {
  if (commands.some((command) =>
    command.status === "cancelled" ||
    (command.status === "not_run" && command.failureCode === "cancelled")
  )) return "cancelled";
  return commands.every((command) => command.status === "passed") ? "passed" : "failed";
}

export function validateVerificationResult(
  value: unknown,
  suite: VerificationSuite,
): asserts value is VerificationResult {
  if (!validateSchema("verificationResult", value).valid) {
    invalidResult("Verification result가 schema를 통과하지 못했습니다.");
  }
  validateVerificationSuite(suite);
  const result = value as VerificationResult;
  const suiteStarted = timestamp(result.startedAt);
  const suiteCompleted = timestamp(result.completedAt);
  if (suiteCompleted < suiteStarted) {
    invalidResult("Verification 완료 시각이 시작 시각보다 이를 수 없습니다.");
  }
  if (
    result.suiteId !== suite.suiteId || result.suiteHash !== verificationSuiteHash(suite) ||
    result.commands.length !== suite.commands.length
  ) {
    invalidResult("Verification result가 실행한 suite와 다릅니다.");
  }
  for (let index = 0; index < result.commands.length; index += 1) {
    const command = suite.commands[index]!;
    const commandResult = result.commands[index]!;
    if (
      commandResult.commandId !== command.commandId ||
      commandResult.commandDigest !== verificationCommandDigest(command)
    ) {
      invalidResult("Verification command 결과의 순서나 digest가 suite와 다릅니다.");
    }
    validateCommandResult(commandResult);
    if (
      commandResult.startedAt !== null &&
      (timestamp(commandResult.startedAt) < suiteStarted ||
        timestamp(commandResult.completedAt!) > suiteCompleted)
    ) {
      invalidResult("Verification command 시각이 suite 실행 구간 밖에 있습니다.");
    }
  }
  if (
    result.status !== expectedOverallStatus(result.commands) ||
    result.verificationId !== calculateVerificationId(result)
  ) {
    invalidResult("Verification 전체 상태 또는 result ID가 명령 증거와 다릅니다.");
  }
}
