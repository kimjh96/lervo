import { expect, it } from "vitest";
import { assertConvergenceVerificationPassed } from "../src/verification-outcome.js";

it("keeps a cancelled verification distinct from a failed verification", () => {
  expect(() => assertConvergenceVerificationPassed("passed")).not.toThrow();
  expect(() => assertConvergenceVerificationPassed("cancelled")).toThrowError(
    expect.objectContaining({ code: "knowledge_cancelled" }),
  );
  expect(() => assertConvergenceVerificationPassed("failed")).toThrowError(
    expect.objectContaining({ code: "knowledge_verification_failed" }),
  );
});
