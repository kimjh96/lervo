import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { validateInstructionCaptureSuite } from "../../natural-language-evaluation/instruction-capture-contract.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const suite = () =>
  JSON.parse(
    readFileSync(
      resolve(repositoryRoot, "benchmarks/grounding/instruction-capture-v1.json"),
      "utf8",
    ),
  );

describe("owner-turn capture evaluation contract (ADR-0466)", () => {
  it("accepts the recorded suite and reports its agreement", () => {
    expect(validateInstructionCaptureSuite(suite())).toMatchObject({
      instructionCaptureCaseCount: 28,
    });
  });

  it("fails when a non-rule turn becomes a canonical rule proposal", () => {
    const value = suite();
    const negative = value.cases.find((item) => item.form === "negative");
    value.observation.results = value.observation.results.map((result) =>
      result.caseId === negative.caseId
        ? { ...result, observedClass: "durable_instruction", durableDisposition: "canonical" }
        : result,
    );
    expect(() => validateInstructionCaptureSuite(value)).toThrow("non-rule turns became canonical");
  });

  it("fails when durable rules are missed below the recall floor", () => {
    const value = suite();
    const durable = new Set(
      value.cases
        .filter((item) => item.form === "explicit" || item.form === "paraphrased")
        .map((item) => item.caseId),
    );
    value.observation.results = value.observation.results.map((result) =>
      durable.has(result.caseId) ? { ...result, observedClass: "none" } : result,
    );
    expect(() => validateInstructionCaptureSuite(value)).toThrow(/agreement|recall/u);
  });

  it("requires implicit corrections to carry the agent turn they correct", () => {
    const value = suite();
    value.cases.find((item) => item.form === "implicit_correction").precedingAgentTurn = null;
    expect(() => validateInstructionCaptureSuite(value)).toThrow("without the agent turn");
  });
});
