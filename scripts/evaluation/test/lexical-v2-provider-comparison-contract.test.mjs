import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import {
  evaluateLexicalV2ProviderAcceptance,
  validateLexicalV2ProviderSuite,
} from "../../natural-language-evaluation/lexical-v2-provider-comparison-contract.mjs";

const repositoryRoot = resolve(import.meta.dirname, "../../..");

async function loadSuite(path) {
  const value = JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
  if (value.baseSuite === undefined) return value;
  const base = await loadSuite(value.baseSuite);
  return {
    ...base,
    ...value,
    ...(value.additionalCases === undefined
      ? {}
      : { cases: [...base.cases, ...value.additionalCases] }),
  };
}

describe("lexical-v2 provider comparison contract", () => {
  it("keeps every v12 gate while bounding v13 candidate evidence to two documents", async () => {
    const suite = validateLexicalV2ProviderSuite(
      await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v13.json"),
      repositoryRoot,
    );

    expect(suite.schemaVersion).toBe(13);
    expect(suite.evidenceDelivery.candidateMaximumDocuments).toBe(2);
    expect(suite.acceptance).toMatchObject({
      maximumTokenRatioBasisPoints: 9_000,
      maximumDurationRatioBasisPoints: 9_500,
      maximumFailedContracts: 0,
      maximumToolOrCommandObservations: 0,
      minimumCandidatePassedObservations: 27,
      minimumCandidateCasesPassingEveryRepetition: 9,
      minimumCandidateRecallBasisPoints: 8_500,
      minimumCandidatePrecisionBasisPoints: 5_000,
      maximumProviderErrors: 0,
    });
  });

  it("preserves every gate when v14 admits one explicit linked authority", async () => {
    const suite = validateLexicalV2ProviderSuite(
      await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v14.json"),
      repositoryRoot,
    );

    expect(suite.evidenceDelivery).toMatchObject({
      anchorDocuments: 2,
      linkedExpansionDocuments: 1,
      candidateMaximumDocuments: 3,
    });
    expect(suite.acceptance.maximumInjectedByteRatioBasisPoints).toBe(7_000);
    expect(suite.acceptance.maximumDurationRatioBasisPoints).toBe(9_500);
  });

  it("keeps the v15 authority-preserving delivery inside unchanged gates", async () => {
    const suite = validateLexicalV2ProviderSuite(
      await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v15.json"),
      repositoryRoot,
    );

    expect(suite.evidenceDelivery).toMatchObject({
      anchorDocuments: 2,
      candidateMaximumDocuments: 2,
      linkedExpansionBeforeSecondaryAnchors: true,
      primaryDocumentFullTextMaximumBytes: 8_192,
    });
    expect(suite.acceptance).toEqual(
      (await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v14.json")).acceptance,
    );
  });

  it("binds the same minimal provider runtime without changing v16 gates", async () => {
    const suite = validateLexicalV2ProviderSuite(
      await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v16.json"),
      repositoryRoot,
    );

    expect(suite.providerBaseInstructionsDigest).toBe(
      "sha256:9c4d25f88dec9a8fdfbf0a30ab01573a88a07a4132014d3bb80b1f939bb711ef",
    );
    expect(suite.acceptance).toEqual(
      (await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v15.json")).acceptance,
    );
  });

  it("requires isolated rolling preparation and the stricter schema without lowering v17 gates", async () => {
    const suite = validateLexicalV2ProviderSuite(
      await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v17.json"),
      repositoryRoot,
    );

    expect(suite.providerPreparation).toBe("rolling_prewarm_isolated_session");
    expect(suite.structuredOutputSchemaDigest).toBe(
      "sha256:f85f2f743540aaca3c598b284c8624e95046f023583b9f945d71bf5bdc2f96a8",
    );
    expect(suite.acceptance).toMatchObject({
      maximumDurationRatioBasisPoints: 9_500,
      maximumTokenRatioBasisPoints: 9_000,
      maximumFailedContracts: 0,
      maximumProviderErrors: 0,
      requireProviderPreparation: true,
    });
  });

  it("inherits every v17 control for the query-aligned v18 confirmation", async () => {
    const v17 = await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v17.json");
    const suite = validateLexicalV2ProviderSuite(
      await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v18.json"),
      repositoryRoot,
    );

    expect(suite.schemaVersion).toBe(18);
    expect(suite.acceptance).toEqual(v17.acceptance);
    expect(suite.providerPreparation).toBe(v17.providerPreparation);
    expect(suite.structuredOutputSchemaDigest).toBe(v17.structuredOutputSchemaDigest);
  });

  it("changes only the provider preparation policy for v19", async () => {
    const v18 = await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v18.json");
    const suite = validateLexicalV2ProviderSuite(
      await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v19.json"),
      repositoryRoot,
    );

    expect(suite.providerPreparation).toBe("provider_native_isolated_prewarm");
    expect(suite.acceptance).toEqual(v18.acceptance);
    expect(suite.cases).toEqual(v18.cases);
    expect(suite.structuredOutputSchemaDigest).toBe(v18.structuredOutputSchemaDigest);
  });

  it("increases v20 sampling while preserving every proportional gate", async () => {
    const v19 = await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v19.json");
    const suite = validateLexicalV2ProviderSuite(
      await loadSuite("benchmarks/search/lexical-v2-provider-comparison-v20.json"),
      repositoryRoot,
    );

    expect(suite.repetitionsPerArm).toBe(5);
    expect(suite.maximumProviderInvocations).toBe(120);
    expect(suite.acceptance).toEqual({
      ...v19.acceptance,
      minimumCandidatePassedObservations: 45,
    });
    expect(suite.cases).toEqual(v19.cases);
    expect(suite.providerPreparation).toBe(v19.providerPreparation);
    expect(suite.structuredOutputSchemaDigest).toBe(v19.structuredOutputSchemaDigest);
  });

  it("keeps the v2 suite stricter than the original provider gate", async () => {
    const suite = validateLexicalV2ProviderSuite(
      JSON.parse(
        await readFile(
          resolve(repositoryRoot, "benchmarks/search/lexical-v2-provider-comparison-v2.json"),
          "utf8",
        ),
      ),
      repositoryRoot,
    );

    expect(suite.acceptance).toMatchObject({
      maximumTokenRatioBasisPoints: 9_000,
      maximumDurationRatioBasisPoints: 9_500,
      maximumInjectedByteRatioBasisPoints: 7_000,
      requireStructuredOutput: true,
    });
  });

  it("fails byte or structured-carrier regressions independently", () => {
    const arm = {
      observations: 2,
      passed: 2,
      expectedPathRecall: 1,
      returnedPathPrecision: 1,
      failedContracts: 0,
      toolOrCommandObservations: 0,
      totalDurationMs: 100,
      totalTokens: 100,
      usageObserved: 2,
      totalInjectedBytes: 100,
      structuredOutputRequested: 2,
    };
    const policy = {
      requireCasePassNonRegression: true,
      requireRecallNonInferiority: true,
      requirePrecisionNonInferiority: true,
      maximumTokenRatioBasisPoints: 9_000,
      maximumDurationRatioBasisPoints: 9_500,
      maximumFailedContracts: 0,
      maximumToolOrCommandObservations: 0,
      requireCompleteUsage: true,
      maximumInjectedByteRatioBasisPoints: 7_000,
      requireStructuredOutput: true,
    };
    const runs = [
      {
        caseId: "case",
        arms: { lexical_v1: { passed: true }, lexical_v2: { passed: true } },
      },
    ];

    const result = evaluateLexicalV2ProviderAcceptance(
      policy,
      {
        lexicalV1: arm,
        lexicalV2: {
          ...arm,
          totalInjectedBytes: 80,
          structuredOutputRequested: 0,
        },
      },
      runs,
    );

    expect(result.criteria.injectedByteRatio).toBe(false);
    expect(result.criteria.structuredOutput).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("rejects a relative non-regression when the candidate misses absolute quality floors", () => {
    const arm = {
      observations: 24,
      passed: 0,
      casesPassingEveryRepetition: 0,
      expectedPathRecall: 0,
      returnedPathPrecision: 0,
      failedContracts: 0,
      toolOrCommandObservations: 0,
      totalDurationMs: 100,
      totalTokens: 100,
      usageObserved: 24,
      totalInjectedBytes: 100,
      structuredOutputRequested: 24,
    };
    const policy = {
      requireCasePassNonRegression: true,
      requireRecallNonInferiority: true,
      requirePrecisionNonInferiority: true,
      maximumTokenRatioBasisPoints: 9_000,
      maximumDurationRatioBasisPoints: 9_500,
      maximumFailedContracts: 0,
      maximumToolOrCommandObservations: 0,
      requireCompleteUsage: true,
      maximumInjectedByteRatioBasisPoints: 7_000,
      requireStructuredOutput: true,
      minimumCandidatePassedObservations: 18,
      minimumCandidateCasesPassingEveryRepetition: 6,
      minimumCandidateRecallBasisPoints: 8_500,
      minimumCandidatePrecisionBasisPoints: 5_000,
    };
    const result = evaluateLexicalV2ProviderAcceptance(policy, { lexicalV1: arm, lexicalV2: arm }, [
      {
        caseId: "case",
        arms: { lexical_v1: { passed: false }, lexical_v2: { passed: false } },
      },
    ]);

    expect(result.criteria).toMatchObject({
      casePassNonRegression: true,
      candidatePassedObservations: false,
      candidateCasesPassingEveryRepetition: false,
      candidateRecall: false,
      candidatePrecision: false,
    });
    expect(result.passed).toBe(false);
  });

  it("requires valid contracts and isolation from both comparison arms", () => {
    const valid = {
      observations: 1,
      passed: 1,
      casesPassingEveryRepetition: 1,
      expectedPathRecall: 1,
      returnedPathPrecision: 1,
      failedContracts: 0,
      toolOrCommandObservations: 0,
      providerErrors: 0,
      totalDurationMs: 100,
      totalTokens: 100,
      usageObserved: 1,
      totalInjectedBytes: 100,
      structuredOutputRequested: 1,
    };
    const result = evaluateLexicalV2ProviderAcceptance(
      {
        requireCasePassNonRegression: true,
        requireRecallNonInferiority: true,
        requirePrecisionNonInferiority: true,
        maximumTokenRatioBasisPoints: 10_000,
        maximumDurationRatioBasisPoints: 10_000,
        maximumFailedContracts: 0,
        maximumToolOrCommandObservations: 0,
        requireCompleteUsage: true,
        maximumProviderErrors: 0,
      },
      {
        lexicalV1: { ...valid, failedContracts: 1, providerErrors: 1 },
        lexicalV2: valid,
      },
      [
        {
          caseId: "case",
          arms: { lexical_v1: { passed: true }, lexical_v2: { passed: true } },
        },
      ],
    );

    expect(result.criteria.providerContracts).toBe(false);
    expect(result.criteria.providerErrors).toBe(false);
    expect(result.passed).toBe(false);
  });
});
