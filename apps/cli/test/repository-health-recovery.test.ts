import { expect, it } from "vitest";

import { convergenceRecovery } from "../src/repository-health-recovery.js";

it("names the failed verification command a stop must fix (ADR-0562)", () => {
  expect(
    convergenceRecovery({
      verificationFailure: {
        suiteId: "repository.default.v9",
        commandId: "repository-lint",
        status: "timed_out",
        exitCode: null,
        durationMs: 300356,
      },
    }),
  ).toBe(
    "fix verification command repository-lint (timed_out after 300s); it reruns after a source or Lervo change (lervo knowledge convergence status)",
  );
  expect(
    convergenceRecovery({
      verificationFailure: {
        suiteId: "s",
        commandId: "repository-isolated-workspace-prepare",
        status: "failed",
        exitCode: 1,
        durationMs: 132,
      },
    }),
  ).toBe(
    "fix verification command repository-isolated-workspace-prepare (failed exit 1 after 132ms); it reruns after a source or Lervo change (lervo knowledge convergence status)",
  );
  // A command the host could not run or finish is checked again later, not left to the sources.
  expect(
    convergenceRecovery({
      reason: "knowledge_verification_environment_failed",
      verificationFailure: {
        suiteId: "repository.default.v9",
        commandId: "repository-lint",
        status: "execution_error",
        exitCode: null,
        durationMs: 3,
      },
    }),
  ).toBe(
    "verification command repository-lint (execution_error after 3ms) could not run on this host after backoff retries; it reruns within 6 hours or after a source or Lervo change (lervo knowledge convergence status)",
  );
  expect(
    convergenceRecovery({
      reason: "knowledge_verification_timed_out",
      verificationFailure: {
        suiteId: "repository.default.v9",
        commandId: "repository-lint",
        status: "timed_out",
        exitCode: null,
        durationMs: 1800000,
      },
    }),
  ).toBe(
    "verification command repository-lint (timed_out after 1800s) ran out of time; it reruns within 6 hours or after a source or Lervo change (lervo knowledge convergence status)",
  );
  // A scheduled retry and a recovery command keep their meaning; nothing recorded says so.
  expect(
    convergenceRecovery({
      retry: { attemptCount: 1, attemptLimit: 3, nextAttemptAt: "2026-11-23T12:00:00Z" },
    }),
  ).toBe("retry at 2026-11-23T12:00:00Z");
  expect(convergenceRecovery({ recoveryCommand: "lervo knowledge recover" })).toBe(
    "inspect lervo knowledge recover",
  );
  expect(convergenceRecovery({})).toBe("none recorded (lervo knowledge convergence status)");
  // A malformed recorded failure keeps only the fields it can show.
  expect(
    convergenceRecovery({
      verificationFailure: { commandId: "repository-lint", status: "failed" } as never,
    }),
  ).toBe(
    "fix verification command repository-lint (failed); it reruns after a source or Lervo change (lervo knowledge convergence status)",
  );
});
