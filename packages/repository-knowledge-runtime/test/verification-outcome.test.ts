import { describe, expect, it } from "vitest";
import type { VerificationResult } from "@lervo/schemas";
import {
  assertConvergenceVerificationPassed,
  convergenceVerificationFailure,
} from "../src/verification-outcome.js";

const HASH = `sha256:${"a".repeat(64)}`;

function command(
  status: VerificationResult["commands"][number]["status"],
  exitCode: number | null = null,
): VerificationResult["commands"][number] {
  return {
    commandId: `c-${status}`,
    status,
    exitCode,
    durationMs: 1,
    stdoutArtifact: null,
    stderrArtifact: null,
    failureCode: null,
  } as unknown as VerificationResult["commands"][number];
}

function result(
  status: VerificationResult["status"],
  commands: VerificationResult["commands"],
): Pick<VerificationResult, "status" | "commands"> {
  return { status, commands };
}

describe("convergence verification outcome", () => {
  it("keeps a cancelled verification distinct from a failed verification", () => {
    expect(() =>
      assertConvergenceVerificationPassed(result("passed", [command("passed")]), HASH),
    ).not.toThrow();
    expect(() =>
      assertConvergenceVerificationPassed(result("cancelled", [command("cancelled")]), HASH),
    ).toThrowError(expect.objectContaining({ code: "knowledge_cancelled", dependencyHash: HASH }));
    expect(() =>
      assertConvergenceVerificationPassed(result("failed", [command("failed", 1)]), HASH),
    ).toThrowError(
      expect.objectContaining({ code: "knowledge_verification_failed", dependencyHash: HASH }),
    );
  });

  it("names a failure the host caused by the first command that did not pass", () => {
    for (const failed of [
      command("execution_error"),
      command("failed", 127),
      command("failed", 126),
    ])
      expect(
        convergenceVerificationFailure(result("failed", [command("passed"), failed]), HASH),
      ).toMatchObject({ code: "knowledge_verification_environment_failed", dependencyHash: HASH });
    // A timeout costs its whole limit, so it gets its own code that is reevaluated, not retried.
    expect(
      convergenceVerificationFailure(
        result("failed", [command("passed"), command("timed_out")]),
        HASH,
      ),
    ).toMatchObject({ code: "knowledge_verification_timed_out", dependencyHash: HASH });
  });

  it("keeps a command that ran and reported failure on the source path", () => {
    for (const failed of [
      command("failed", 1),
      command("failed", null),
      command("output_limit_exceeded"),
      // A command cancelled inside a suite that still reports failure is not the host's fault.
      command("cancelled"),
    ])
      expect(convergenceVerificationFailure(result("failed", [failed]), HASH)).toMatchObject({
        code: "knowledge_verification_failed",
      });
    // Only the first failed command decides: a later timeout does not excuse a lint failure.
    expect(
      convergenceVerificationFailure(
        result("failed", [command("failed", 2), command("timed_out")]),
        HASH,
      ),
    ).toMatchObject({ code: "knowledge_verification_failed" });
    expect(
      convergenceVerificationFailure(
        result("failed", [command("not_run"), command("failed", 1)]),
        HASH,
      ),
    ).toMatchObject({ code: "knowledge_verification_failed" });
  });
});
