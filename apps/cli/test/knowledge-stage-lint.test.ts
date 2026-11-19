import type { KnowledgeLintResult } from "@lervo/repository-knowledge";
import { describe, expect, it } from "vitest";

import { validateKnowledgeStage } from "../src/knowledge-stage-lint.js";

function result(issues: KnowledgeLintResult["issues"]): KnowledgeLintResult {
  return {
    schemaVersion: 1,
    coverage: "complete",
    skippedForBudget: { count: 0, bytes: 0, classes: [] },
    repositoryRoot: "/fixture",
    valid: issues.every((issue) => issue.severity !== "error"),
    checkedConcepts: 1,
    issues,
  };
}

describe("knowledge stage lint", () => {
  it("rejects a Markdown link a content rewrite breaks, and keeps one that was already broken", () => {
    const link = (target: string, path = "docs/roadmap/plan.md") => ({
      code: "markdown_link_target_missing",
      severity: "warning" as const,
      path,
      target,
      message: `Line 3 links to ${target}, which does not exist.`,
    });
    const existing = link("docs/old/gone.md");
    const input = {
      stage: "background normalization",
      before: result([existing]),
      ownedErrorCodes: new Set<string>(),
      rejectNewBrokenLinksIn: new Set(["docs/roadmap/plan.md"]),
    };
    expect(validateKnowledgeStage({ ...input, after: result([existing]) }).valid).toBe(true);
    const broken = link("docs/decisions/typed-context/0292-moved.md");
    expect(() => validateKnowledgeStage({ ...input, after: result([existing, broken]) })).toThrow(
      expect.objectContaining({
        code: "knowledge_lint_failed",
        links: [{ path: "docs/roadmap/plan.md", target: broken.target }],
      }),
    );
    // A document the stage did not write keeps warning-only behavior.
    const elsewhere = link("docs/missing.md", "docs/other.md");
    expect(validateKnowledgeStage({ ...input, after: result([existing, elsewhere]) }).valid).toBe(
      true,
    );
    // A truncated link report could hide an old broken link, so the check stands down.
    const truncated = {
      code: "document_reference_findings_truncated",
      severity: "warning" as const,
      path: ".",
      reasons: ["markdown_link_target_missing"],
      message: "1 additional markdown_link_target_missing findings were omitted.",
    };
    expect(
      validateKnowledgeStage({ ...input, after: result([existing, broken, truncated]) }).valid,
    ).toBe(true);
    // Stages that move documents pass no written set and keep the old rule.
    expect(
      validateKnowledgeStage({
        stage: input.stage,
        before: input.before,
        ownedErrorCodes: input.ownedErrorCodes,
        after: result([existing, broken]),
      }).valid,
    ).toBe(true);
  });

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

it.each(["before", "after"] as const)(
  "rejects partial %s lint before producing a receipt",
  (side) => {
    const input = { before: result([]), after: result([]) };
    input[side] = {
      ...input[side],
      coverage: "partial",
      skippedForBudget: { count: 1, bytes: 64, classes: ["other_documents"] },
    };
    expect(() =>
      validateKnowledgeStage({ ...input, stage: "migration", ownedErrorCodes: new Set() }),
    ).toThrow(expect.objectContaining({ code: "knowledge_source_limit_exceeded" }));
  },
);
