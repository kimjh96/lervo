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
  validateCatalogAssistedV3Alignment,
  validateCatalogAssistedV3Suite,
  validateCoreTermAssistedV4Alignment,
  validateCoreTermAssistedV4Suite,
  validateReferenceMarkerAssistedV5Alignment,
  validateReferenceMarkerAssistedV5Suite,
  validateMarkerDerivedPathsV6Suite,
  validateStagedEvidenceV7Suite,
  validateLinkedEvidenceReconciliationV8Suite,
  validateLinkedEvidenceReconciliationConfirmationV9Suite,
  validateLexicalV2ProviderSuite,
  validateLexicalV2RealUseReview,
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
import {
  buildCatalogAssistedV3Catalog,
  catalogAssistedV3ProtocolDigest,
  parseCatalogAssistedV3Coverage,
} from "../natural-language-evaluation/catalog-assisted-v3-contract.mjs";
import {
  catalogAssistedV3Protocol,
  evaluateCatalogAssistedV3Acceptance,
} from "../natural-language-evaluation/catalog-assisted-v3-runner.mjs";
import {
  buildCoreTermAssistedV4Coverage,
  coreTermAssistedV4ProtocolDigest,
  parseCoreTermAssistedV4NoHitInspection,
} from "../natural-language-evaluation/core-term-assisted-v4-contract.mjs";
import {
  coreTermAssistedV4Protocol,
  evaluateCoreTermAssistedV4Acceptance,
} from "../natural-language-evaluation/core-term-assisted-v4-runner.mjs";
import {
  evaluateReferenceMarkerAssistedV5Contract,
  referenceMarkerAssistedV5ProtocolDigest,
} from "../natural-language-evaluation/reference-marker-assisted-v5-contract.mjs";
import {
  evaluateReferenceMarkerAssistedV5Acceptance,
  referenceMarkerAssistedV5Protocol,
} from "../natural-language-evaluation/reference-marker-assisted-v5-runner.mjs";
import { evaluateMarkerDerivedPathsV6Acceptance } from "../natural-language-evaluation/marker-derived-paths-v6-runner.mjs";
import {
  buildMarkerDerivedPathsV6NoHitCatalog,
  markerDerivedPathsV6ProtocolDigest,
  parseMarkerDerivedPathsV6Result,
} from "../natural-language-evaluation/marker-derived-paths-v6-contract.mjs";
import {
  buildStagedEvidenceV7NoHitCatalog,
  parseStagedEvidenceV7Answer,
  parseStagedEvidenceV7Selection,
  stagedEvidenceV7ProtocolDigest,
  stagedEvidenceV7SelectionProtocol,
} from "../natural-language-evaluation/staged-evidence-v7-contract.mjs";
import { evaluateStagedEvidenceV7Acceptance } from "../natural-language-evaluation/staged-evidence-v7-runner.mjs";
import {
  buildLinkedEvidenceReconciliationV8Expansion,
  exactPathSetReconciled,
  linkedEvidenceReconciliationV8HitAnswerProtocol,
  linkedEvidenceReconciliationV8ProtocolDigest,
} from "../natural-language-evaluation/linked-evidence-reconciliation-v8-contract.mjs";
import { evaluateLinkedEvidenceReconciliationV8Acceptance } from "../natural-language-evaluation/linked-evidence-reconciliation-v8-runner.mjs";
import {
  linkedEvidenceReconciliationConfirmationV9ProtocolDigest,
  normalizeLinkedEvidenceReconciliationConfirmationV9Suite,
} from "../natural-language-evaluation/linked-evidence-reconciliation-confirmation-v9-contract.mjs";

const root = resolve(import.meta.dirname, "../..");
const load = (path) => JSON.parse(readFileSync(resolve(root, path), "utf8"));

describe("natural-language evaluation corpus", () => {
  it("validates the paired retrieval and grounding contracts", () => {
    expect(checkNaturalLanguageEvaluation(root)).toMatchObject({
      pairCount: 20,
      caseCount: 32,
      categoryCount: 8,
      lexicalV2RealUseReviewCaseCount: 4,
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
      catalogAssistedV3CaseCount: 8,
      coreTermAssistedV4CaseCount: 8,
      referenceMarkerAssistedV5CaseCount: 8,
      markerDerivedPathsV6CaseCount: 8,
      stagedEvidenceV7CaseCount: 8,
      linkedEvidenceReconciliationV8CaseCount: 8,
      linkedEvidenceReconciliationConfirmationV9CaseCount: 8,
      lexicalV2ProviderCaseCount: 8,
      groundingReportId: expect.stringMatching(/^ngreport_[a-f0-9]{24}$/u),
    });
  });

  it("rejects lexical-v2 provider comparison protocol drift", () => {
    const suite = load("benchmarks/search/lexical-v2-provider-comparison-v1.json");
    expect(validateLexicalV2ProviderSuite(suite, root).cases).toHaveLength(8);
    suite.protocolDigest = `sha256:${"0".repeat(64)}`;
    expect(() => validateLexicalV2ProviderSuite(suite, root)).toThrow("header is invalid");
  });

  it("retains the exact approved lexical-v2 real-use case set", () => {
    const suite = load("benchmarks/search/lexical-v2-real-use-reviewed-v1.json");
    expect(validateLexicalV2RealUseReview(suite, root).cases).toHaveLength(4);
    suite.cases.pop();
    expect(() => validateLexicalV2RealUseReview(suite, root)).toThrow("retain all four cases");
  });

  it("rejects lexical-v2 real-use approval-binding drift", () => {
    const suite = load("benchmarks/search/lexical-v2-real-use-reviewed-v1.json");
    suite.review.bindingHash = `sha256:${"0".repeat(64)}`;
    expect(() => validateLexicalV2RealUseReview(suite, root)).toThrow(
      "authority or privacy contract changed",
    );
  });

  it("pre-registers v9 as an exact separately identified v8 confirmation", () => {
    const v8 = load("benchmarks/search/linked-evidence-reconciliation-v8.json");
    const v9 = load("benchmarks/search/linked-evidence-reconciliation-confirmation-v9.json");
    expect(validateLinkedEvidenceReconciliationConfirmationV9Suite(v9, root)).toBe(v9);
    expect(normalizeLinkedEvidenceReconciliationConfirmationV9Suite(v9)).toEqual(v8);
    expect(v9.protocolDigest).toBe(linkedEvidenceReconciliationConfirmationV9ProtocolDigest);
    expect(v9.confirmation).toMatchObject({
      kind: "exact_replication",
      priorObservationsReusable: false,
      reportsMayBeCombined: false,
    });
  });

  it("pre-registers v8 without changing v7 ground truth or no-hit expectations", () => {
    const v7 = load("benchmarks/search/staged-evidence-v7.json");
    const v8 = load("benchmarks/search/linked-evidence-reconciliation-v8.json");
    expect(validateLinkedEvidenceReconciliationV8Suite(v8, root).repetitionsPerArm).toBe(3);
    expect(v8.protocolDigest).toBe(linkedEvidenceReconciliationV8ProtocolDigest);
    expect(linkedEvidenceReconciliationV8HitAnswerProtocol).toContain(
      "protocol document is not repository evidence",
    );
    expect(v8.cases.map(({ caseId: _caseId, ...item }) => item)).toEqual(
      v7.cases.map(({ caseId: _caseId, ...item }) => item),
    );
    expect(v8.stages.noHitBehavior).toBe("staged_evidence_v7_unchanged");
  });

  it("expands only a deterministic bounded prefix of recommendation links", () => {
    const source = (path, text) => ({ path, text });
    const recommendation = source(
      "docs/start.md",
      [
        "[First](./first.md)",
        "[Duplicate](./first.md)",
        "[External](https://example.com/out.md)",
        "[Outside](../../outside.md)",
        "[Second](./second.md#part)",
        "[Third](./third.md)",
      ].join("\n"),
    );
    const corpus = [
      recommendation,
      source("docs/first.md", "1111"),
      source("docs/second.md", "22"),
      source("docs/third.md", "3"),
    ];
    const expanded = buildLinkedEvidenceReconciliationV8Expansion({
      corpus,
      recommendations: [recommendation],
      existingPaths: [recommendation.path],
      contract: { maximumLinkedSources: 8, maximumLinkedSourceBytes: 6 },
    });
    expect(expanded).toMatchObject({
      selectedPaths: ["docs/first.md", "docs/second.md"],
      candidateCount: 3,
      truncated: true,
      byteCount: 6,
    });
  });

  it("reconciles exact selected and final path sets independently of ordering", () => {
    expect(exactPathSetReconciled(["docs/a.md", "docs/b.md"], ["docs/b.md", "docs/a.md"])).toBe(
      true,
    );
    expect(exactPathSetReconciled(["docs/a.md", "docs/b.md"], ["docs/a.md"])).toBe(false);
  });

  it("rejects v8 acceptance when hit reconciliation or linked preservation fails", () => {
    const acceptance = load("benchmarks/search/linked-evidence-reconciliation-v8.json").acceptance;
    const summary = {
      observations: 24,
      passed: 24,
      casesPassingEveryRepetition: 8,
      expectedPathRecall: 1,
      totalTokens: 80,
      totalDurationMs: 80,
      usageObservedCases: 24,
      noHitDuration: { p95Ms: 80, standardDeviationMs: 80 },
      failedSelectionContracts: 0,
      failedCoverageContracts: 0,
      failedReconciliationContracts: 0,
      failedSourceMarkerContracts: 0,
      failedResponseContracts: 0,
      providerExecutionFailures: 0,
      droppedRelevantRecommendations: 0,
      droppedRelevantLinkedSources: 0,
      droppedRelevantCoverageSources: 0,
      droppedRelevantNoHitCandidates: 0,
    };
    const result = evaluateLinkedEvidenceReconciliationV8Acceptance(acceptance, {
      modelDirect: { ...summary, totalTokens: 100, totalDurationMs: 100 },
      linkedEvidenceReconciliationV8: {
        ...summary,
        failedReconciliationContracts: 1,
        droppedRelevantLinkedSources: 1,
      },
    });
    expect(result.criteria).toMatchObject({
      reconciliationContracts: false,
      relevantLinkedSources: false,
      providerExecutions: true,
    });
  });

  it("pre-registers v7 stages without changing v6 ground truth", () => {
    const v6 = load("benchmarks/search/marker-derived-paths-v6.json");
    const v7 = load("benchmarks/search/staged-evidence-v7.json");
    expect(validateStagedEvidenceV7Suite(v7, root).repetitionsPerArm).toBe(3);
    expect(v7.protocolDigest).toBe(stagedEvidenceV7ProtocolDigest);
    expect(stagedEvidenceV7SelectionProtocol).toContain("Return tokens only");
    expect(v7.cases.map(({ caseId: _caseId, ...item }) => item)).toEqual(
      v6.cases.map(({ caseId: _caseId, ...item }) => item),
    );
  });

  it("separates v7 hit and no-hit source selection from prose", () => {
    const source = {
      documentId: "doc_selected",
      path: "docs/selected.md",
      title: "Selected",
      contentHash: `sha256:${"2".repeat(64)}`,
    };
    const catalog = buildStagedEvidenceV7NoHitCatalog([source], 65_536);
    const [entry] = catalog.entries;
    const noHit = parseStagedEvidenceV7Selection({
      rawContent: `<!-- lervo-v7-select:${entry.selectionToken} -->`,
      publicationContent: `<!-- lervo-v7-select:${entry.selectionToken} -->`,
      referencedDocumentPaths: [],
      documents: [catalog.document],
      injectedEvidencePaths: [],
      selectionTokenPaths: catalog.selectionTokenPaths,
      noHits: true,
      maximumNoHitCandidates: 4,
      maximumSelectedSources: 8,
    });
    expect(noHit.protocolObservation).toMatchObject({
      selectedPaths: ["docs/selected.md"],
      candidatePaths: ["docs/selected.md"],
      selectionContractSatisfied: true,
    });
    const hit = parseStagedEvidenceV7Selection({
      rawContent: `<!-- lervo-e4:${source.documentId}:${source.contentHash} -->`,
      publicationContent: "",
      referencedDocumentPaths: ["docs/selected.md"],
      documents: [source],
      injectedEvidencePaths: ["docs/selected.md"],
      selectionTokenPaths: new Map(),
      noHits: false,
      maximumNoHitCandidates: 4,
      maximumSelectedSources: 8,
    });
    expect(hit.protocolObservation.selectionContractSatisfied).toBe(true);
    expect(
      parseStagedEvidenceV7Selection({
        ...noHit,
        rawContent: `선택함\n<!-- lervo-v7-select:${entry.selectionToken} -->`,
        publicationContent: `선택함\n<!-- lervo-v7-select:${entry.selectionToken} -->`,
        referencedDocumentPaths: [],
        documents: [catalog.document],
        injectedEvidencePaths: [],
        selectionTokenPaths: catalog.selectionTokenPaths,
        noHits: true,
        maximumNoHitCandidates: 4,
        maximumSelectedSources: 8,
      }).protocolObservation.selectionContractSatisfied,
    ).toBe(false);
    expect(
      parseStagedEvidenceV7Selection({
        rawContent: `<!-- lervo-e4:${source.documentId}:${source.contentHash} -->\n<!-- lervo-e4:${source.documentId}:${source.contentHash} -->`,
        publicationContent: "",
        referencedDocumentPaths: ["docs/selected.md"],
        documents: [source],
        injectedEvidencePaths: ["docs/selected.md"],
        selectionTokenPaths: new Map(),
        noHits: false,
        maximumNoHitCandidates: 4,
        maximumSelectedSources: 8,
      }).protocolObservation.selectionContractSatisfied,
    ).toBe(false);
  });

  it("derives v7 final paths only from injected exact references", () => {
    const source = {
      documentId: "doc_selected",
      path: "docs/selected.md",
      contentHash: `sha256:${"3".repeat(64)}`,
    };
    const parsed = parseStagedEvidenceV7Answer({
      rawContent: `근거에 따르면 승인 후 적용해야 합니다.\n<!-- lervo-e4:${source.documentId}:${source.contentHash} -->`,
      publicationContent: "근거에 따르면 승인 후 적용해야 합니다.",
      referencedDocumentPaths: ["docs/selected.md"],
      documents: [source],
      injectedEvidencePaths: ["docs/selected.md"],
    });
    expect(parsed.answer.sourcePaths).toEqual(["docs/selected.md"]);
    expect(parsed.protocolObservation).toMatchObject({
      responseContractSatisfied: true,
      sourceMarkerContractSatisfied: true,
    });
    expect(
      parseStagedEvidenceV7Answer({
        rawContent: `근거입니다.\n<!-- lervo-e4:${source.documentId}:${source.contentHash} -->`,
        publicationContent: "근거입니다.",
        referencedDocumentPaths: ["docs/forbidden.md"],
        documents: [{ ...source, path: "docs/forbidden.md" }],
        injectedEvidencePaths: ["docs/selected.md"],
      }).protocolObservation.responseContractSatisfied,
    ).toBe(false);
  });

  it("rejects v7 acceptance when stage selection fails", () => {
    const acceptance = load("benchmarks/search/staged-evidence-v7.json").acceptance;
    const summary = {
      observations: 24,
      passed: 24,
      casesPassingEveryRepetition: 8,
      expectedPathRecall: 1,
      totalTokens: 80,
      totalDurationMs: 80,
      usageObservedCases: 24,
      noHitDuration: { p95Ms: 80, standardDeviationMs: 80 },
      failedSelectionContracts: 0,
      failedCoverageContracts: 0,
      failedSourceMarkerContracts: 0,
      failedResponseContracts: 0,
      providerExecutionFailures: 0,
      droppedRelevantRecommendations: 0,
      droppedRelevantCoverageSources: 0,
      droppedRelevantNoHitCandidates: 0,
    };
    const result = evaluateStagedEvidenceV7Acceptance(acceptance, {
      modelDirect: { ...summary, totalTokens: 100, totalDurationMs: 100 },
      stagedEvidenceV7: { ...summary, failedSelectionContracts: 1 },
    });
    expect(result.criteria).toMatchObject({ selectionContracts: false, providerExecutions: true });
  });

  it("records the approved v6 fuzzy-merge correction without changing the other cases", () => {
    const v5 = load("benchmarks/search/reference-marker-assisted-v5.json");
    const v6 = load("benchmarks/search/marker-derived-paths-v6.json");
    expect(validateMarkerDerivedPathsV6Suite(v6, root).repetitionsPerArm).toBe(3);
    expect(v6.protocolDigest).toBe(markerDerivedPathsV6ProtocolDigest);
    expect(v6.cases[4].expectedPaths).toEqual([
      "docs/decisions/knowledge/semantics/0180-hash-bound-human-conflict-resolution.md",
      "docs/decisions/knowledge/semantics/0227-approval-gated-cross-provider-fuzzy-merge.md",
    ]);
    expect(v6.cases.filter((item, index) => index !== 4).map((item) => item.query)).toEqual(
      v5.cases.filter((item, index) => index !== 4).map((item) => item.query),
    );
  });

  it("derives v6 source paths from exact injected and catalog markers", () => {
    const source = {
      path: "docs/inspected.md",
      title: "Inspected",
      contentHash: `sha256:${"1".repeat(64)}`,
    };
    const catalog = buildMarkerDerivedPathsV6NoHitCatalog([source], 65_536);
    const [entry] = catalog.entries;
    const parsed = parseMarkerDerivedPathsV6Result({
      rawContent: `근거입니다.\n<!-- lervo-v6-inspect:${entry.inspectionToken} -->\n<!-- lervo-v6-source:${entry.sourceToken} -->`,
      publicationContent: `근거입니다.\n<!-- lervo-v6-inspect:${entry.inspectionToken} -->\n<!-- lervo-v6-source:${entry.sourceToken} -->`,
      referencedDocumentPaths: ["docs/injected.md"],
      injectedEvidencePaths: ["docs/injected.md"],
      sourceTokenPaths: catalog.sourceTokenPaths,
      inspectionTokenPaths: catalog.inspectionTokenPaths,
      noHits: true,
      maximumCandidates: 4,
    });
    expect(parsed.answer.sourcePaths).toEqual(["docs/injected.md", "docs/inspected.md"]);
    expect(parsed.protocolObservation).toMatchObject({
      candidatePaths: ["docs/inspected.md"],
      responseContractSatisfied: true,
      sourceMarkerContractSatisfied: true,
    });
    const invalid = parseMarkerDerivedPathsV6Result({
      ...parsed,
      rawContent: "본문\n<!-- lervo-v6-source:sv6_000000000000000000000000 -->",
      publicationContent: "본문\n<!-- lervo-v6-source:sv6_000000000000000000000000 -->",
      referencedDocumentPaths: [],
      injectedEvidencePaths: [],
      sourceTokenPaths: catalog.sourceTokenPaths,
      inspectionTokenPaths: catalog.inspectionTokenPaths,
      noHits: true,
      maximumCandidates: 4,
    });
    expect(invalid.passedContract).toBe(true);
    expect(invalid.protocolObservation.responseContractSatisfied).toBe(false);
  });

  it("keeps v6 response failures separate from provider execution failures", () => {
    const acceptance = load("benchmarks/search/marker-derived-paths-v6.json").acceptance;
    const summary = {
      observations: 24,
      passed: 24,
      casesPassingEveryRepetition: 8,
      expectedPathRecall: 1,
      totalTokens: 80,
      totalDurationMs: 80,
      usageObservedCases: 24,
      noHitDuration: { p95Ms: 80, standardDeviationMs: 80 },
      failedCoverageContracts: 0,
      failedSourceMarkerContracts: 0,
      failedResponseContracts: 0,
      providerExecutionFailures: 0,
      droppedRelevantRecommendations: 0,
      droppedRelevantCoverageSources: 0,
      droppedRelevantNoHitCandidates: 0,
    };
    const result = evaluateMarkerDerivedPathsV6Acceptance(acceptance, {
      modelDirect: { ...summary, totalTokens: 100, totalDurationMs: 100 },
      markerDerivedPathsV6: { ...summary, failedResponseContracts: 1 },
    });
    expect(result.criteria).toMatchObject({ responseContracts: false, providerExecutions: true });
  });

  it("pre-registers v5 observable references without changing v4 ground truth", () => {
    const v4 = load("benchmarks/search/core-term-assisted-v4.json");
    const v5 = load("benchmarks/search/reference-marker-assisted-v5.json");
    expect(validateReferenceMarkerAssistedV5Suite(v5, root).repetitionsPerArm).toBe(3);
    expect(validateReferenceMarkerAssistedV5Alignment(v4, v5).cases).toHaveLength(8);
    expect(v5.protocolDigest).toBe(referenceMarkerAssistedV5ProtocolDigest);
    expect(referenceMarkerAssistedV5Protocol).toContain("reconcile supplied sourcePaths entries");
    expect(referenceMarkerAssistedV5Protocol).toContain(
      "observable output reference, not attention",
    );
  });

  it("requires a bijection between returned supplied paths and v5 evidence markers", () => {
    const input = {
      injectedEvidencePaths: ["docs/alpha.md", "docs/beta.md"],
      sourcePaths: ["docs/alpha.md", "docs/inspected.md"],
      referencedDocumentPaths: ["docs/alpha.md"],
      forbiddenReferencePaths: [".lervo/protocol.md", ".lervo/catalog.md"],
    };
    expect(evaluateReferenceMarkerAssistedV5Contract(input)).toMatchObject({
      satisfied: true,
      expectedReferencePaths: ["docs/alpha.md"],
      observedEvidenceReferencePaths: ["docs/alpha.md"],
    });
    expect(
      evaluateReferenceMarkerAssistedV5Contract({
        ...input,
        referencedDocumentPaths: [],
      }),
    ).toMatchObject({ satisfied: false, missingReferencePaths: ["docs/alpha.md"] });
    expect(
      evaluateReferenceMarkerAssistedV5Contract({
        ...input,
        sourcePaths: ["docs/inspected.md"],
      }),
    ).toMatchObject({ satisfied: false, unreturnedReferencePaths: ["docs/alpha.md"] });
    expect(
      evaluateReferenceMarkerAssistedV5Contract({
        ...input,
        referencedDocumentPaths: ["docs/alpha.md", ".lervo/protocol.md"],
      }),
    ).toMatchObject({ satisfied: false, forbiddenReferencePaths: [".lervo/protocol.md"] });
    expect(
      evaluateReferenceMarkerAssistedV5Contract({
        ...input,
        referencedDocumentPaths: ["docs/alpha.md", "docs/unknown.md"],
      }),
    ).toMatchObject({ satisfied: false, unknownReferencePaths: ["docs/unknown.md"] });
  });

  it("does not accept v5 quality when a relevant returned source lacks a marker", () => {
    const acceptance = load("benchmarks/search/reference-marker-assisted-v5.json").acceptance;
    const modelDirect = {
      observations: 24,
      passed: 21,
      casesPassingEveryRepetition: 6,
      expectedPathRecall: 0.9,
      failedContracts: 0,
      failedCoverageContracts: 0,
      failedReferenceContracts: 0,
      droppedRelevantRecommendations: 0,
      droppedRelevantCoverageSources: 0,
      droppedRelevantNoHitCandidates: 0,
      unreferencedRelevantReturnedSources: 0,
      totalDurationMs: 100_000,
      totalTokens: 100_000,
      usageObservedCases: 24,
      noHitDuration: { p95Ms: 20_000, standardDeviationMs: 2_000 },
    };
    const referenceMarkerAssistedV5 = {
      ...modelDirect,
      totalDurationMs: 80_000,
      totalTokens: 70_000,
      failedReferenceContracts: 1,
      unreferencedRelevantReturnedSources: 1,
    };
    expect(
      evaluateReferenceMarkerAssistedV5Acceptance(acceptance, {
        modelDirect,
        referenceMarkerAssistedV5,
      }),
    ).toMatchObject({
      passed: false,
      criteria: { referenceContracts: false, relevantReturnedReferences: false },
    });
  });

  it("pre-registers v4 deterministic coverage without changing v3 ground truth", () => {
    const v3 = load("benchmarks/search/catalog-assisted-v3.json");
    const v4 = load("benchmarks/search/core-term-assisted-v4.json");
    expect(validateCoreTermAssistedV4Suite(v4, root).repetitionsPerArm).toBe(3);
    expect(validateCoreTermAssistedV4Alignment(v3, v4).cases).toHaveLength(8);
    expect(v4.protocolDigest).toBe(coreTermAssistedV4ProtocolDigest);
    expect(coreTermAssistedV4Protocol).toContain("category-independent rule");
    expect(coreTermAssistedV4Protocol).toContain("no provider-authored completeness field");
  });

  it("selects v4 core and per-term bodies mechanically without duplicates", () => {
    const source = (path) => ({
      kind: "document",
      sourceId: `doc_${path}`,
      path,
      contentHash: `sha256:${"0".repeat(64)}`,
      text: `# ${path}\n`,
    });
    const corpus = [
      source("README.md"),
      source("docs/architecture/system.md"),
      source("docs/specifications/execution.md"),
      source("docs/term-alpha.md"),
      source("docs/term-beta.md"),
      source("docs/recommended.md"),
    ];
    const byTerm = new Map([
      ["alpha", corpus[3]],
      ["beta", corpus[4]],
      ["repeat", corpus[3]],
      ["recommended", corpus[5]],
    ]);
    const result = buildCoreTermAssistedV4Coverage({
      corpus,
      recommendations: [corpus[5]],
      query: "Alpha beta repeat recommended",
      coverage: {
        corePaths: ["README.md", "docs/architecture/system.md", "docs/specifications/execution.md"],
        maximumAsciiTerms: 8,
        termLexicalLimit: 1,
        maximumInjectedCoverageBytes: 98_304,
      },
      searchLexical: (_corpus, term) => (byTerm.has(term) ? [byTerm.get(term)] : []),
    });
    expect(result.selectedPaths).toEqual([
      "README.md",
      "docs/architecture/system.md",
      "docs/specifications/execution.md",
      "docs/term-alpha.md",
      "docs/term-beta.md",
    ]);
    expect(result.documents.map((item) => item.path)).toEqual(result.selectedPaths);
  });

  it("requires observable candidates only for v4 lexical no-hits", () => {
    const catalogPaths = new Set(["docs/alpha.md", "docs/beta.md"]);
    expect(
      parseCoreTermAssistedV4NoHitInspection(
        { noHitInspection: { candidatePaths: ["docs/beta.md"], reason: "Inspect beta." } },
        { noHits: true, catalogPaths, maximumCandidates: 4 },
      ),
    ).toEqual({ candidatePaths: ["docs/beta.md"], reason: "Inspect beta." });
    expect(
      parseCoreTermAssistedV4NoHitInspection(
        { noHitInspection: { candidatePaths: [], reason: null } },
        { noHits: false, catalogPaths, maximumCandidates: 4 },
      ),
    ).toEqual({ candidatePaths: [], reason: null });
    expect(() =>
      parseCoreTermAssistedV4NoHitInspection(
        { noHitInspection: { candidatePaths: ["docs/alpha.md"], reason: "Not a no-hit." } },
        { noHits: false, catalogPaths, maximumCandidates: 4 },
      ),
    ).toThrow("cannot claim no-hit inspection");
  });

  it("does not accept v4 quality when a relevant deterministic source is dropped", () => {
    const acceptance = load("benchmarks/search/core-term-assisted-v4.json").acceptance;
    const modelDirect = {
      observations: 24,
      passed: 21,
      casesPassingEveryRepetition: 6,
      expectedPathRecall: 0.9,
      failedContracts: 0,
      failedCoverageContracts: 0,
      droppedRelevantRecommendations: 0,
      droppedRelevantCoverageSources: 0,
      droppedRelevantNoHitCandidates: 0,
      totalDurationMs: 100_000,
      totalTokens: 100_000,
      usageObservedCases: 24,
      noHitDuration: { p95Ms: 20_000, standardDeviationMs: 2_000 },
    };
    const coreTermAssistedV4 = {
      ...modelDirect,
      totalDurationMs: 80_000,
      totalTokens: 70_000,
      droppedRelevantCoverageSources: 1,
    };
    expect(
      evaluateCoreTermAssistedV4Acceptance(acceptance, {
        modelDirect,
        coreTermAssistedV4,
      }),
    ).toMatchObject({
      passed: false,
      criteria: { relevantCoverageSources: false },
    });
  });

  it("pre-registers v3 catalog coverage without changing v2 ground truth", () => {
    const v2 = load("benchmarks/search/lexical-assisted-v2.json");
    const v3 = load("benchmarks/search/catalog-assisted-v3.json");
    expect(validateCatalogAssistedV3Suite(v3, root).repetitionsPerArm).toBe(3);
    expect(validateCatalogAssistedV3Alignment(v2, v3).cases).toHaveLength(8);
    expect(v3.protocolDigest).toBe(catalogAssistedV3ProtocolDigest);
    expect(catalogAssistedV3Protocol).toContain("coverage checklist");
    expect(catalogAssistedV3Protocol).not.toContain("task type");
  });

  it("builds a bounded path-title catalog without source bodies", () => {
    const catalog = buildCatalogAssistedV3Catalog([
      {
        path: "docs/alpha.md",
        title: "Alpha",
        text: "secret alpha body",
      },
      {
        path: "docs/beta.md",
        title: "Beta",
        text: "secret beta body",
      },
    ]);
    expect(catalog.entries).toEqual([
      { path: "docs/alpha.md", title: "Alpha" },
      { path: "docs/beta.md", title: "Beta" },
    ]);
    expect(catalog.document.delivery.content).not.toContain("secret");
    expect(catalog.byteCount).toBeLessThanOrEqual(65_536);
  });

  it("rejects v3 catalog candidates outside the catalog or inside supplied anchors", () => {
    const catalogPaths = new Set(["docs/alpha.md", "docs/beta.md"]);
    const recommendationPaths = new Set(["docs/alpha.md"]);
    expect(
      parseCatalogAssistedV3Coverage(
        {
          coverageAssessment: {
            status: "catalog_candidates_named",
            candidatePaths: ["docs/beta.md"],
            reason: "Beta may complete the evidence bundle.",
          },
        },
        catalogPaths,
        recommendationPaths,
      ),
    ).toMatchObject({ status: "catalog_candidates_named", candidatePaths: ["docs/beta.md"] });
    expect(() =>
      parseCatalogAssistedV3Coverage(
        {
          coverageAssessment: {
            status: "catalog_candidates_named",
            candidatePaths: ["docs/missing.md"],
            reason: "Missing path.",
          },
        },
        catalogPaths,
        recommendationPaths,
      ),
    ).toThrow("outside the catalog");
    expect(() =>
      parseCatalogAssistedV3Coverage(
        {
          coverageAssessment: {
            status: "catalog_candidates_named",
            candidatePaths: ["docs/alpha.md"],
            reason: "Repeated anchor.",
          },
        },
        catalogPaths,
        recommendationPaths,
      ),
    ).toThrow("repeats a supplied anchor");
  });

  it("rejects v3 ground-truth and protocol drift", () => {
    const v2 = load("benchmarks/search/lexical-assisted-v2.json");
    const v3 = load("benchmarks/search/catalog-assisted-v3.json");
    v3.cases[0].query += " 변경";
    expect(() => validateCatalogAssistedV3Alignment(v2, v3)).toThrow(
      "changes the v2 comparison ground truth",
    );
    const protocolDrift = load("benchmarks/search/catalog-assisted-v3.json");
    protocolDrift.protocolDigest = `sha256:${"0".repeat(64)}`;
    expect(() => validateCatalogAssistedV3Suite(protocolDrift, root)).toThrow(
      "suite header is invalid",
    );
  });

  it("does not accept v3 resource savings with worse no-hit variance", () => {
    const acceptance = load("benchmarks/search/catalog-assisted-v3.json").acceptance;
    const modelDirect = {
      observations: 24,
      passed: 21,
      casesPassingEveryRepetition: 6,
      expectedPathRecall: 0.9,
      failedContracts: 0,
      failedCatalogContracts: 0,
      droppedRelevantRecommendations: 0,
      droppedRelevantCatalogCandidates: 0,
      totalDurationMs: 100_000,
      totalTokens: 100_000,
      usageObservedCases: 24,
      noHitDuration: { p95Ms: 20_000, standardDeviationMs: 2_000 },
    };
    const catalogAssistedV3 = {
      ...modelDirect,
      totalDurationMs: 80_000,
      totalTokens: 70_000,
      noHitDuration: { p95Ms: 19_000, standardDeviationMs: 3_000 },
    };
    expect(
      evaluateCatalogAssistedV3Acceptance(acceptance, { modelDirect, catalogAssistedV3 }),
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
