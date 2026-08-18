import type { WritingEvaluation } from "@roven/schemas";
import { validateSchema } from "@roven/schemas";
import { describe, expect, it } from "vitest";

import {
  defaultKoreanWritingContract,
  evaluateWritingGate,
  lintDeterministicWriting,
} from "../src/index.js";

const artifactId = "art_01234567";
const contentHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const evidenceDigest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function evaluation(status: "failed" | "not_run" | "passed"): WritingEvaluation {
  const deterministicChecks = lintDeterministicWriting(
    "문서 규칙을 적용했습니다. 추가 조치는 없습니다.",
    defaultKoreanWritingContract,
  );
  return {
    schemaVersion: 1,
    evaluationId: "wre_01234567",
    writingPolicyId: defaultKoreanWritingContract.writingPolicyId,
    artifactId,
    contentHash,
    locale: defaultKoreanWritingContract.locale,
    checkedAt: "2026-08-18T00:00:00Z",
    evaluators: [
      { kind: "deterministic", evaluatorId: "roven-writing-lint-v1" },
      { kind: "model", evaluatorId: "roven-writing-review-v1", phase: "separate_pass" },
    ],
    checks: [
      ...deterministicChecks,
      ...defaultKoreanWritingContract.verification.semanticChecks.map((check) => ({
        checkId: check.checkId,
        kind: "semantic" as const,
        status,
        violationCount: status === "failed" ? 1 : 0,
        evidenceDigest: status === "not_run" ? null : evidenceDigest,
      })),
    ],
    overallStatus: status === "passed" ? "passed" : status === "failed" ? "failed" : "incomplete",
  };
}

describe("provider-neutral writing verification", () => {
  it("keeps the default Korean writing policy schema-valid", () => {
    expect(validateSchema("writingContract", defaultKoreanWritingContract)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("catches only deterministic expression violations in the lint pass", () => {
    const results = lintDeterministicWriting(
      "# 결과\n\n사람 확인 필요 — 이 변경을 봉인합니다.\n\n## 비어 있는 절",
      defaultKoreanWritingContract,
    );

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ checkId: "forbid_em_dash", status: "failed" }),
        expect.objectContaining({
          checkId: "forbid_abstract_action_subject",
          status: "failed",
        }),
        expect.objectContaining({ checkId: "no_empty_sections", status: "failed" }),
        expect.objectContaining({ checkId: "forbid_vague_terms", status: "failed" }),
      ]),
    );
  });

  it("does not treat an unrun semantic review as natural prose", () => {
    expect(
      evaluateWritingGate({
        contract: defaultKoreanWritingContract,
        evaluation: evaluation("not_run"),
        artifactId,
        contentHash,
      }),
    ).toMatchObject({
      allowed: false,
      failure: "writing_verification_failed",
      failedChecks: [
        "natural_ko-kr_prose",
        "plain_audience_language",
        "direct_result_and_action",
      ],
    });
  });

  it("opens publication only after every required check passes", () => {
    const result = evaluation("passed");
    expect(validateSchema("writingEvaluation", result)).toEqual({ valid: true, errors: [] });
    expect(
      evaluateWritingGate({
        contract: defaultKoreanWritingContract,
        evaluation: result,
        artifactId,
        contentHash,
      }),
    ).toEqual({ allowed: true, missingChecks: [], failedChecks: [] });
  });

  it("rejects passed checks produced without a separate semantic evaluator", () => {
    const result = evaluation("passed");
    result.evaluators = result.evaluators.filter((evaluator) => evaluator.kind === "deterministic");

    expect(
      evaluateWritingGate({
        contract: defaultKoreanWritingContract,
        evaluation: result,
        artifactId,
        contentHash,
      }),
    ).toMatchObject({
      allowed: false,
      missingChecks: ["semantic_evaluator"],
    });
  });

  it("rejects an evaluation copied from a different artifact revision", () => {
    expect(
      evaluateWritingGate({
        contract: defaultKoreanWritingContract,
        evaluation: evaluation("passed"),
        artifactId,
        contentHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      }),
    ).toMatchObject({ allowed: false, coordinateMismatch: true });
  });
});
