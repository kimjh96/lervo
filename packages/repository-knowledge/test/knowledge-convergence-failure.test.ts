import { expect, it } from "vitest";
import {
  convergenceRetryLimit,
  normalizedConvergenceFailure,
  reevaluatedConvergenceFailure,
  unclassifiedFailureCause,
  VERIFICATION_FAILURE_CODES,
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

it("retries a verification the host could not run, never one that ran and failed", () => {
  expect(normalizedConvergenceFailure({ code: "knowledge_verification_environment_failed" })).toBe(
    "knowledge_verification_environment_failed",
  );
  expect(convergenceRetryLimit("knowledge_verification_environment_failed")).toBe(4);
  expect(normalizedConvergenceFailure({ code: "knowledge_verification_timed_out" })).toBe(
    "knowledge_verification_timed_out",
  );
  expect(convergenceRetryLimit("knowledge_verification_timed_out")).toBeNull();
  expect(convergenceRetryLimit("knowledge_verification_failed")).toBeNull();
  // Each failure the host may have caused is reevaluated later; a source failure is not.
  for (const code of [
    "knowledge_stage_failure_unclassified",
    "knowledge_verification_environment_failed",
    "knowledge_verification_timed_out",
  ])
    expect(reevaluatedConvergenceFailure(code)).toBe(true);
  expect(reevaluatedConvergenceFailure("knowledge_verification_failed")).toBe(false);
  // Every verification code names its failed command in the status.
  expect([...VERIFICATION_FAILURE_CODES].sort()).toEqual([
    "knowledge_verification_environment_failed",
    "knowledge_verification_failed",
    "knowledge_verification_timed_out",
  ]);
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

it("types a project manifest that lervo upgrade briefly rewrites as a transient failure", () => {
  // digimon: a stage read `.lervo/project.yaml` while `lervo upgrade` was rewriting it.
  const code = normalizedConvergenceFailure({ code: "not_initialized" });
  expect(code).toBe("knowledge_project_unavailable");
  expect(convergenceRetryLimit(code)).toBe(16);
  expect(normalizedConvergenceFailure({ code: "knowledge_verification_modified_sources" })).toBe(
    "knowledge_verification_modified_sources",
  );
});

it("keeps an unclassified failure's identifier-shaped code and name, never its message", () => {
  expect(
    unclassifiedFailureCause(
      Object.assign(new TypeError("private /path detail"), { code: "ERR_SOMETHING_NEW" }),
    ),
  ).toEqual({ code: "ERR_SOMETHING_NEW", name: "TypeError" });
  expect(unclassifiedFailureCause({ code: "has spaces and /paths", name: "x y" })).toEqual({
    code: null,
    name: null,
  });
  expect(unclassifiedFailureCause(null)).toEqual({ code: null, name: null });
});
