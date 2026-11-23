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
