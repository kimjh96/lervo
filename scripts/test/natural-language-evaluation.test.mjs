import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  checkNaturalLanguageEvaluation,
  validateGroundingSuite,
  validateLexicalFailureCandidates,
  validateNaturalLanguageCaseReview,
  validateRetrievalPair,
  validateBoundedFallbackAlignment,
  validateDelegatedRetrievalSuite,
  validateLexicalAssistedV2Suite,
} from "../check-natural-language-evaluation.mjs";
import {
  boundedFallbackProtocol,
  evaluateFallbackAcceptance,
  validateFallbackRecommendations,
} from "../natural-language-evaluation/bounded-retrieval-runner.mjs";
import {
  parseLexicalAssistedV2EvidenceGap,
  validateLexicalAssistedV2Recommendations,
} from "../natural-language-evaluation/lexical-assisted-v2-contract.mjs";
import {
  evaluateLexicalAssistedV2Acceptance,
  lexicalAssistedV2Protocol,
} from "../natural-language-evaluation/lexical-assisted-v2-runner.mjs";

const root = resolve(import.meta.dirname, "../..");
const load = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

describe("natural-language evaluation corpus", () => {
  it("validates the paired retrieval and grounding contracts", () => {
    expect(checkNaturalLanguageEvaluation(root)).toMatchObject({
      pairCount: 20,
      caseCount: 32,
      categoryCount: 8,
      preReviewPairCount: 20,
      preReviewGroundingCaseCount: 32,
      preReviewAttentionCount: 9,
      lexicalFailureCandidateCount: 4,
      lexicalFailureTaskTypeCount: 3,
      lexicalRankingRegressionCount: 1,
      lexicalDiscoveryProbeCount: 3,
      delegatedRetrievalCaseCount: 8,
      boundedFallbackCaseCount: 8,
      lexicalAssistedV2CaseCount: 8,
      groundingReportId: expect.stringMatching(/^ngreport_[a-f0-9]{24}$/u),
    });
  });

  it("pre-registers v2 evidence-gap and relevant-recommendation contracts", () => {
    const suite = load("benchmarks/search/lexical-assisted-v2.json");
    expect(validateLexicalAssistedV2Suite(suite, root).repetitionsPerArm).toBe(3);
    expect(lexicalAssistedV2Protocol).toContain("concrete evidence gap");
    expect(
      parseLexicalAssistedV2EvidenceGap({
        evidenceGap: { status: "none", code: null, reason: null },
      }),
    ).toEqual({ status: "none", code: null, reason: null });
    expect(() =>
      parseLexicalAssistedV2EvidenceGap({
        evidenceGap: {
          status: "named",
          code: "lexical_no_hits",
          reason: "No lexical recommendations were supplied.",
        },
      }),
    ).not.toThrow();
  });

  it("rejects v2 lexical recommendation drift", () => {
    const suite = load("benchmarks/search/lexical-assisted-v2.json");
    const hitCase = suite.cases.find((item) => item.lexicalExpectation === "recommendations");
    const noHitCase = suite.cases.find((item) => item.lexicalExpectation === "no_hits");
    expect(() => validateLexicalAssistedV2Recommendations(hitCase, [])).toThrow(
      "drifted from pre-registration",
    );
    expect(() => validateLexicalAssistedV2Recommendations(noHitCase, [{}])).toThrow(
      "drifted from pre-registration",
    );
  });

  it("rejects lexical-assisted v2 protocol drift", () => {
    const suite = load("benchmarks/search/lexical-assisted-v2.json");
    suite.protocolDigest = `sha256:${"0".repeat(64)}`;
    expect(() => validateLexicalAssistedV2Suite(suite, root)).toThrow("suite header is invalid");
  });

  it("does not accept v2 resource savings with worse no-hit variance", () => {
    const acceptance = load("benchmarks/search/lexical-assisted-v2.json").acceptance;
    const modelDirect = {
      observations: 24,
      passed: 21,
      casesPassingEveryRepetition: 6,
      expectedPathRecall: 0.9,
      failedContracts: 0,
      failedEvidenceGapContracts: 0,
      droppedRelevantRecommendations: 0,
      totalDurationMs: 100_000,
      totalTokens: 100_000,
      usageObservedCases: 24,
      noHitDuration: { p95Ms: 20_000, standardDeviationMs: 2_000 },
    };
    const lexicalAssistedV2 = {
      ...modelDirect,
      totalDurationMs: 80_000,
      totalTokens: 70_000,
      noHitDuration: { p95Ms: 19_000, standardDeviationMs: 3_000 },
    };
    expect(
      evaluateLexicalAssistedV2Acceptance(acceptance, { modelDirect, lexicalAssistedV2 }),
    ).toMatchObject({
      passed: false,
      criteria: {
        tokenRatio: true,
        durationRatio: true,
        noHitP95Ratio: true,
        noHitStandardDeviationRatio: false,
      },
    });
  });

  it("rejects a bounded fallback trigger that contradicts the task type", () => {
    const suite = load("benchmarks/search/bounded-retrieval-fallback-v1.json");
    suite.cases[0].fallbackTrigger = "impact_verification";
    expect(() => validateDelegatedRetrievalSuite(suite, root)).toThrow("contradicts its task type");
  });

  it("rejects bounded fallback ground-truth drift from the pilot", () => {
    const pilot = load("benchmarks/search/delegated-retrieval-pilot-v1.json");
    const fallback = load("benchmarks/search/bounded-retrieval-fallback-v1.json");
    fallback.cases[0].query += " 변경";
    expect(() => validateBoundedFallbackAlignment(pilot, fallback)).toThrow(
      "changes the delegated retrieval ground truth",
    );
  });

  it("requires repository inspection only for triggered fallback", () => {
    expect(boundedFallbackProtocol("lexical_only")).not.toContain("MUST inspect");
    expect(boundedFallbackProtocol("lexical_no_hits")).toContain("MUST inspect");
    expect(boundedFallbackProtocol("impact_verification")).toContain("MUST independently inspect");
    expect(boundedFallbackProtocol("approval_boundary_verification")).toContain(
      "MUST independently inspect",
    );
  });

  it("rejects lexical results that contradict a fallback trigger", () => {
    expect(() => validateFallbackRecommendations("lexical_no_hits", [])).not.toThrow();
    expect(() => validateFallbackRecommendations("lexical_only", [{}])).not.toThrow();
    expect(() => validateFallbackRecommendations("lexical_no_hits", [{}])).toThrow(
      "contradicts the lexical result",
    );
    expect(() => validateFallbackRecommendations("lexical_only", [])).toThrow(
      "contradicts the lexical result",
    );
  });

  it("fails acceptance when savings do not preserve direct-arm quality", () => {
    const acceptance = load("benchmarks/search/bounded-retrieval-fallback-v1.json").acceptance;
    const modelDirect = {
      observations: 16,
      passed: 14,
      casesPassingEveryRepetition: 6,
      expectedPathRecall: 0.875,
      failedContracts: 0,
      failedFallbackTriggers: 0,
      totalDurationMs: 100_000,
      totalTokens: 100_000,
      usageObservedCases: 16,
    };
    const boundedFallback = {
      ...modelDirect,
      passed: 13,
      expectedPathRecall: 0.8125,
      totalDurationMs: 80_000,
      totalTokens: 70_000,
    };
    expect(evaluateFallbackAcceptance(acceptance, { modelDirect, boundedFallback })).toMatchObject({
      passed: false,
      criteria: {
        passCountNonInferiority: false,
        recallNonInferiority: false,
        tokenRatio: true,
        durationRatio: true,
      },
    });
  });

  it("rejects delegated retrieval corpus self-influence", () => {
    const suite = load("benchmarks/search/delegated-retrieval-pilot-v1.json");
    suite.corpusExclusions = suite.corpusExclusions.filter(
      (path) => !path.includes("0225-revise-local-hybrid"),
    );
    expect(() => validateDelegatedRetrievalSuite(suite, root)).toThrow(
      "permits self-influence or drift",
    );
  });

  it("rejects a delegated retrieval case with a stale expected path", () => {
    const suite = load("benchmarks/search/delegated-retrieval-pilot-v1.json");
    suite.cases[0].expectedPaths = ["docs/missing.md"];
    expect(() => validateDelegatedRetrievalSuite(suite, root)).toThrow(
      "expected path is not a current Markdown source",
    );
  });

  it("rejects a paired query that changes expected ground truth", () => {
    const korean = load("benchmarks/search/korean-repository-retrieval-v1.json");
    const control = load("benchmarks/search/korean-repository-retrieval-control-v1.json");
    control.cases[0].expectedPaths = ["docs/roadmap/v0.md"];
    expect(() => validateRetrievalPair(root, korean, control)).toThrow(
      "changes more than prompt language and framing",
    );
  });

  it("rejects a Korean-framed query without Hangul", () => {
    const korean = load("benchmarks/search/korean-repository-retrieval-v1.json");
    const control = load("benchmarks/search/korean-repository-retrieval-control-v1.json");
    korean.cases[0].query = "commit convention work";
    expect(() => validateRetrievalPair(root, korean, control)).toThrow("has no Hangul");
  });

  it("rejects a corpus that includes its evaluation decision", () => {
    const korean = load("benchmarks/search/korean-repository-retrieval-v1.json");
    const control = load("benchmarks/search/korean-repository-retrieval-control-v1.json");
    korean.corpusExclusions = ["docs/evidence/search", "docs/knowledge"];
    expect(() => validateRetrievalPair(root, korean, control)).toThrow(
      "permits self-influence or drift",
    );
  });

  it("rejects execution when a conversational reference is unresolved", () => {
    const grounding = load("benchmarks/grounding/natural-language-repository-v1.json");
    const target = grounding.cases.find((item) => item.caseId === "ngcase_ambiguous_two_targets");
    target.expectation.disposition = "inspect_then_execute";
    expect(() => validateGroundingSuite(grounding)).toThrow("executes an unresolved reference");
  });

  it("rejects approval resolution without one exact binding", () => {
    const grounding = load("benchmarks/grounding/natural-language-repository-v1.json");
    const target = grounding.cases.find(
      (item) => item.caseId === "ngcase_approval_exact_second_option",
    );
    target.context.pendingAuthority = "multiple_or_unbound";
    expect(() => validateGroundingSuite(grounding)).toThrow(
      "resolves approval without one exact binding",
    );
  });

  it("rejects a missing fail-closed grounding category case", () => {
    const grounding = load("benchmarks/grounding/natural-language-repository-v1.json");
    grounding.cases.pop();
    expect(() => validateGroundingSuite(grounding)).toThrow("invalid item count");
  });

  it("rejects roadmap recovery while a current workstream is available", () => {
    const grounding = load("benchmarks/grounding/natural-language-repository-v1.json");
    const target = grounding.cases.find((item) => item.caseId === "ngcase_task_next_work");
    target.context.currentWorkstream = "available";
    expect(() => validateGroundingSuite(grounding)).toThrow(
      "resolves an unavailable repository roadmap",
    );
  });

  it("rejects a pre-review that skips one retrieval pair", () => {
    const korean = load("benchmarks/search/korean-repository-retrieval-v1.json");
    const control = load("benchmarks/search/korean-repository-retrieval-control-v1.json");
    const grounding = load("benchmarks/grounding/natural-language-repository-v1.json");
    const review = load("benchmarks/reviews/natural-language-repository-v1.json");
    review.retrieval.readyPairIds.pop();
    expect(() => validateNaturalLanguageCaseReview(review, korean, control, grounding)).toThrow(
      "does not cover every case exactly once",
    );
  });

  it("rejects a pre-review that claims human approval", () => {
    const korean = load("benchmarks/search/korean-repository-retrieval-v1.json");
    const control = load("benchmarks/search/korean-repository-retrieval-control-v1.json");
    const grounding = load("benchmarks/grounding/natural-language-repository-v1.json");
    const review = load("benchmarks/reviews/natural-language-repository-v1.json");
    review.humanApproval = true;
    expect(() => validateNaturalLanguageCaseReview(review, korean, control, grounding)).toThrow(
      "overstates human approval",
    );
  });

  it("rejects lexical failure coverage that claims every task type", () => {
    const korean = load("benchmarks/search/korean-repository-retrieval-v1.json");
    const control = load("benchmarks/search/korean-repository-retrieval-control-v1.json");
    const candidates = load(
      "benchmarks/search/natural-language-lexical-failure-candidates-v1.json",
    );
    candidates.allTaskTypesCovered = true;
    expect(() => validateLexicalFailureCandidates(candidates, korean, control, root)).toThrow(
      "all-task-types claim is inaccurate",
    );
  });

  it("rejects a lexical failure bound to the wrong paired case", () => {
    const korean = load("benchmarks/search/korean-repository-retrieval-v1.json");
    const control = load("benchmarks/search/korean-repository-retrieval-control-v1.json");
    const candidates = load(
      "benchmarks/search/natural-language-lexical-failure-candidates-v1.json",
    );
    candidates.failures[0].pairId = "nlpair_boundary_graph_score";
    expect(() => validateLexicalFailureCandidates(candidates, korean, control, root)).toThrow(
      "does not bind to its declared retrieval pair",
    );
  });

  it("rejects a discovery probe whose stored digest does not match its public text", () => {
    const korean = load("benchmarks/search/korean-repository-retrieval-v1.json");
    const control = load("benchmarks/search/korean-repository-retrieval-control-v1.json");
    const candidates = load(
      "benchmarks/search/natural-language-lexical-failure-candidates-v1.json",
    );
    candidates.discoveryProbes[0].query += " 수정";
    expect(() => validateLexicalFailureCandidates(candidates, korean, control, root)).toThrow(
      "invalid operational no-hit observation",
    );
  });
});
