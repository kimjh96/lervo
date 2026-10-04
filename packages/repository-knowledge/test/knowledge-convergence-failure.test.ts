import { expect, it } from "vitest";
import { normalizedConvergenceFailure } from "../src/knowledge-convergence-failure.js";

it("normalizes managed verification cancellation without retrying it as a transient error", () => {
  expect(normalizedConvergenceFailure({ code: "cancelled" })).toBe("knowledge_cancelled");
  expect(normalizedConvergenceFailure({ code: "knowledge_verification_failed" })).toBe(
    "knowledge_verification_failed",
  );
  expect(normalizedConvergenceFailure({ code: "unrecognized_failure" })).toBe(
    "knowledge_job_transient_failure",
  );
});

it("retries a typed normalizer timeout while retaining other compile failures", () => {
  expect(
    normalizedConvergenceFailure({ code: "knowledge_compile_failed", processStatus: "timed_out" }),
  ).toBe("knowledge_job_transient_failure");
  expect(
    normalizedConvergenceFailure({ code: "knowledge_compile_failed", processStatus: "failed" }),
  ).toBe("knowledge_compile_failed");
  expect(normalizedConvergenceFailure({ code: "knowledge_compile_failed" })).toBe(
    "knowledge_compile_failed",
  );
  expect(
    normalizedConvergenceFailure({
      code: "knowledge_compile_failed",
      message: "The provider compiler executable version could not be determined.",
    }),
  ).toBe("knowledge_job_transient_failure");
});
