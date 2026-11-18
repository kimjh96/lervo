import { expect, it } from "vitest";

import { documentNormalizationProcedure } from "@lervo/repository-knowledge";

it("leaves pending normalization to background convergence unless the user asks", () => {
  const procedure = documentNormalizationProcedure(20);
  expect(procedure).toContain("20 documents await normalization");
  expect(procedure).toContain("Background knowledge convergence normalizes them");
  expect(procedure).not.toContain("whatever its task");
  expect(procedure).toContain("--scope all-pending --max-provider-calls 8");
  expect(procedure).toContain("--apply <planId>");
  // ADR-0561: Lervo cross-checks the candidate itself; no per-item approval is asked.
  expect(procedure).toContain("cross-checks the candidate in an independent session");
  expect(procedure).not.toContain("--approve-item");
});
