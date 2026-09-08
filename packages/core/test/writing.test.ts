import type { WritingEvaluation } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  adaptiveConversationWritingContract,
  defaultEnglishWritingContract,
  defaultWritingContract,
  evaluateWritingGate,
  lintDeterministicWriting,
  writingContractForLanguage,
  fixedEnglishStatusWritingContract,
  realtimeConversationWritingContract,
} from "../src/index.js";

const artifactId = "art_01234567";
const contentHash = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const evidenceDigest = "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function evaluation(status: "failed" | "not_run" | "passed"): WritingEvaluation {
  const deterministicChecks = lintDeterministicWriting(
    "The document rules were applied. No further action is needed.",
    defaultEnglishWritingContract,
  );
  return {
    schemaVersion: 1,
    evaluationId: "wre_01234567",
    writingPolicyId: defaultEnglishWritingContract.writingPolicyId,
    artifactId,
    contentHash,
    locale: defaultEnglishWritingContract.locale,
    checkedAt: "2026-08-18T00:00:00Z",
    evaluators: [
      { kind: "deterministic", evaluatorId: "lervo-writing-lint-v1" },
      { kind: "model", evaluatorId: "lervo-writing-review-v1", phase: "separate_pass" },
    ],
    checks: [
      ...deterministicChecks,
      ...defaultEnglishWritingContract.verification.semanticChecks.map((check) => ({
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
  it("keeps the default English writing policy schema-valid", () => {
    expect(validateSchema("writingContract", defaultEnglishWritingContract)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("keeps adaptive conversation publication distinct from English documentation", () => {
    expect(validateSchema("writingContract", adaptiveConversationWritingContract)).toEqual({
      valid: true,
      errors: [],
    });
    expect(adaptiveConversationWritingContract).toMatchObject({
      locale: "mul",
      surfaces: ["chat"],
    });
  });

  it("keeps the realtime conversation policy deterministic and separately identifiable", () => {
    expect(validateSchema("writingContract", realtimeConversationWritingContract)).toEqual({
      valid: true,
      errors: [],
    });
    expect(realtimeConversationWritingContract).toMatchObject({
      writingPolicyId: "writing_mul-realtime-conversation",
      locale: "mul",
      surfaces: ["chat"],
      verification: { semanticChecks: [] },
    });
  });

  it("keeps fixed status publication deterministic without claiming semantic review", () => {
    expect(validateSchema("writingContract", fixedEnglishStatusWritingContract)).toEqual({
      valid: true,
      errors: [],
    });
    expect(fixedEnglishStatusWritingContract.verification.semanticChecks).toEqual([]);
    const result = evaluation("passed");
    result.writingPolicyId = fixedEnglishStatusWritingContract.writingPolicyId;
    result.evaluators = result.evaluators.filter((evaluator) => evaluator.kind === "deterministic");
    result.checks = result.checks.filter((check) => check.kind === "deterministic");
    expect(
      evaluateWritingGate({
        contract: fixedEnglishStatusWritingContract,
        evaluation: result,
        artifactId,
        contentHash,
      }),
    ).toEqual({ allowed: true, missingChecks: [], failedChecks: [] });
  });

  it("resolves the v1 publication language and rejects unsupported languages", () => {
    expect(writingContractForLanguage("en")).toEqual(defaultEnglishWritingContract);
    expect(writingContractForLanguage("en")).not.toBe(defaultEnglishWritingContract);
    expect(defaultWritingContract).toBe(defaultEnglishWritingContract);
    expect(() => writingContractForLanguage("ko-KR")).toThrow(
      "Unsupported writing publication language: ko-KR",
    );
  });

  it("catches only deterministic expression violations in the lint pass", () => {
    const results = lintDeterministicWriting(
      "# Result\n\nThe user must check this — it is obviously ready.\n\n## Empty section",
      defaultEnglishWritingContract,
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
        contract: defaultEnglishWritingContract,
        evaluation: evaluation("not_run"),
        artifactId,
        contentHash,
      }),
    ).toMatchObject({
      allowed: false,
      failure: "writing_verification_failed",
      missingChecks: expect.arrayContaining([
        "natural_en_prose",
        "plain_audience_language",
        "direct_result_and_action",
      ]),
      failedChecks: [],
    });
  });

  it("opens publication only after every required check passes", () => {
    const result = evaluation("passed");
    expect(validateSchema("writingEvaluation", result)).toEqual({ valid: true, errors: [] });
    expect(
      evaluateWritingGate({
        contract: defaultEnglishWritingContract,
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
        contract: defaultEnglishWritingContract,
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
        contract: defaultEnglishWritingContract,
        evaluation: evaluation("passed"),
        artifactId,
        contentHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
      }),
    ).toMatchObject({ allowed: false, coordinateMismatch: true });
  });
});
