import { expect, it } from "vitest";
import {
  convergenceRetryLimit,
  normalizedConvergenceFailure,
} from "../src/knowledge-convergence-failure.js";

it("normalizes managed verification cancellation without retrying it as a transient error", () => {
  expect(normalizedConvergenceFailure({ code: "cancelled" })).toBe("knowledge_cancelled");
  expect(normalizedConvergenceFailure({ code: "knowledge_verification_failed" })).toBe(
    "knowledge_verification_failed",
  );
  expect(normalizedConvergenceFailure({ code: "knowledge_job_transient_failure" })).toBe(
    "knowledge_job_transient_failure",
  );
});

it("separates untyped host failures from typed transient failures", () => {
  // A failed Git child process carries its numeric exit status, not a convergence code.
  expect(normalizedConvergenceFailure(Object.assign(new Error("git"), { code: 128 }))).toBe(
    "knowledge_stage_failure_unclassified",
  );
  expect(normalizedConvergenceFailure({ code: "unrecognized_failure" })).toBe(
    "knowledge_stage_failure_unclassified",
  );
  expect(normalizedConvergenceFailure(new Error("plain"))).toBe(
    "knowledge_stage_failure_unclassified",
  );
  expect(normalizedConvergenceFailure({ code: "knowledge_integration_target_unavailable" })).toBe(
    "knowledge_integration_target_unavailable",
  );
});

it("bounds untyped failures more tightly than typed transient failures", () => {
  expect(convergenceRetryLimit("knowledge_job_transient_failure")).toBe(16);
  expect(convergenceRetryLimit("knowledge_materialization_busy")).toBe(16);
  expect(convergenceRetryLimit("knowledge_stage_failure_unclassified")).toBe(4);
  expect(convergenceRetryLimit("knowledge_integration_target_unavailable")).toBeNull();
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
