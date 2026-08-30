import type { KnowledgeLintResult } from "@lervo/repository-knowledge";
import { describe, expect, it } from "vitest";

import { validateKnowledgeStage } from "../src/knowledge-stage-lint.js";

function result(issues: KnowledgeLintResult["issues"]): KnowledgeLintResult {
  return {
    schemaVersion: 1,
    repositoryRoot: "/fixture",
    valid: issues.every((issue) => issue.severity !== "error"),
    checkedConcepts: 1,
    issues,
  };
}

describe("knowledge stage lint", () => {
  it("retains an unrelated pre-existing issue without hiding it", () => {
    const issue = {
      code: "publication_missing",
      severity: "error" as const,
      path: "docs/knowledge/index.md",
      message: "The publication is missing.",
    };
    const validated = validateKnowledgeStage({
      stage: "document normalization",
      before: result([issue]),
      after: result([issue]),
      ownedErrorCodes: new Set(["invalid_document_normalization_record"]),
    });
    expect(validated.valid).toBe(true);
    expect(validated.issues[0]).toMatchObject({
      code: "publication_missing",
      severity: "warning",
    });
  });

  it("reports new blockers and the pre-rollback coordinates", () => {
    expect(() =>
      validateKnowledgeStage({
        stage: "structural materialization",
        before: result([]),
        after: result([
          {
            code: "publication_missing",
            severity: "error",
            path: "docs/knowledge/index.md",
            message: "The publication is missing.",
          },
        ]),
        ownedErrorCodes: new Set(["publication_missing"]),
      }),
    ).toThrow(
      "Materialized bytes were rejected and rolled back. Blocking findings observed before rollback: publication_missing:docs/knowledge/index.md",
    );
  });
});
