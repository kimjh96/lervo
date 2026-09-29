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
