import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { linkedEvidenceReconciliationV8SelectionProtocolDigest } from "../../natural-language-evaluation/linked-evidence-reconciliation-v8-contract.mjs";
import { authorizedProviderShadowContractDigest } from "../../natural-language-evaluation/linked-evidence-provider-shadow-pilot-contract.mjs";
import { evaluateProviderShadowReview } from "../../natural-language-evaluation/linked-evidence-provider-shadow-pilot-review.mjs";
import { parseProviderShadowSelection } from "../../natural-language-evaluation/linked-evidence-provider-shadow-pilot-turn.mjs";

const repositoryRoot = new URL("../../..", import.meta.url);
const contractPath = new URL(
  "benchmarks/search/linked-evidence-provider-shadow-pilot-v1.json",
  repositoryRoot,
);

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function digest(bytes) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

describe("linked-evidence provider-shadow pilot contract", () => {
  it("binds a design-only 24-call population to the exact v3 and v8 evidence", async () => {
    const contract = await readJson(contractPath);
    const suitePath = new URL(contract.groundTruth.sourceSuitePath, repositoryRoot);
    const suiteBytes = await readFile(suitePath);
    const suite = JSON.parse(suiteBytes.toString("utf8"));
    const eligibleCases = suite.cases.filter(
      (item) => item.lexicalExpectation === contract.groundTruth.eligibleLexicalExpectation,
    );

    expect(contract.authorization).toMatchObject({
      status: "design_only",
      providerCallsAuthorized: false,
      managedContextEffectsAuthorized: false,
      canaryAuthorized: false,
      productionActivationAuthorized: false,
    });
    expect(contract.sourcePopulation.phaseAManifestDigest).toBe(
      "sha256:a6f113f7999d5e52c50016faa269e71bf048c08642735fa06dd80ff05d8897c7",
    );
    expect(digest(await readFile(contractPath))).toBe(authorizedProviderShadowContractDigest);
    expect(digest(suiteBytes)).toBe(contract.groundTruth.sourceSuiteDigest);
    expect(eligibleCases).toHaveLength(6);
    expect(eligibleCases.length * contract.sourcePopulation.expectedRepetitionsPerCase).toBe(24);
    expect(contract.provider.maximumProviderInvocations).toBe(24);
    expect(contract.provider.maximumAttemptsPerSample).toBe(1);
    expect(contract.provider.maximumRetries).toBe(0);
    expect(contract.provider.maximumReplacementSamples).toBe(0);
  });

  it("preserves the exact selection protocol, measured envelope, and no-effect gate", async () => {
    const contract = await readJson(contractPath);

    expect(contract.selectionProtocol.protocolDigest).toBe(
      linkedEvidenceReconciliationV8SelectionProtocolDigest,
    );
    expect(contract.candidateEnvelope).toMatchObject({
      sourceRecommendationBatch: "lexical_v1_ordered_maximum_5",
      ordinaryOperationalSelections: "top_ranked_v1_ordered_maximum_3_unchanged",
      expectedMaximumCandidateSources: 16,
      expectedMaximumProviderVisibleSourceBytes: 130302,
      maximumProviderVisibleSourceBytesPerCall: 262144,
    });
    expect(contract.noEffect).toEqual({
      operationalSearchSelection: "unchanged",
      primaryManagedContext: "unchanged",
      primaryOutput: "unchanged",
      managedWrites: "unchanged",
      verification: "unchanged",
      semanticPublication: "unchanged",
      e1ThroughE4Events: "unchanged",
      directTerminals: "unchanged",
      canaryTraffic: "none",
      productionActivation: "none",
    });
    expect(contract.acceptance).toMatchObject({
      requiredEligibleObservations: 24,
      minimumReviewedExpectedPathRecallBasisPoints: 10000,
      minimumMeanSelectionPrecisionBasisPoints: 6500,
      minimumPerObservationSelectionPrecisionBasisPoints: 5000,
      maximumPrimaryEffectDifferences: 0,
    });
    expect(contract.passingDisposition).toBe("separate_canary_design_review_only");
  });

  it("accepts only standalone exact candidate tokens with no prose", () => {
    const candidates = [
      { documentId: "doc_one", contentHash: `sha256:${"a".repeat(64)}` },
      { documentId: "doc_two", contentHash: `sha256:${"b".repeat(64)}` },
    ];
    const token = (candidate) =>
      `<!-- lervo-e4:${candidate.documentId}:${candidate.contentHash} -->`;
    expect(
      parseProviderShadowSelection(candidates.map(token).join("\n"), candidates, 8),
    ).toMatchObject({ passed: true, selected: candidates });
    const sources = candidates.map(({ documentId, ...candidate }) => ({
      ...candidate,
      sourceId: documentId,
    }));
    expect(
      parseProviderShadowSelection(candidates.map(token).join("\n"), sources, 8),
    ).toMatchObject({ passed: true, selected: candidates });
    expect(
      parseProviderShadowSelection(`selected\n${token(candidates[0])}`, candidates, 8).passed,
    ).toBe(false);
    expect(
      parseProviderShadowSelection(
        `${token(candidates[0])}\n${token(candidates[0])}`,
        candidates,
        8,
      ).passed,
    ).toBe(false);
  });

  it("requires every pre-registered review gate without combining scores", async () => {
    const contract = await readJson(contractPath);
    const observation = {
      status: "observed",
      providerInvocationCount: 1,
      privacyFailed: false,
      replayMatched: true,
      primaryContextUnchanged: true,
      primaryOutputUnchanged: true,
      managedWritesUnchanged: true,
      verificationUnchanged: true,
      publicationUnchanged: true,
      e1ThroughE4EventsUnchanged: true,
      precisionBasisPoints: 7500,
      recallBasisPoints: 10000,
      shadowSelectedCount: 4,
      failureCode: null,
      terminalStatus: "completed",
      usageDigest: `sha256:${"c".repeat(64)}`,
      observedTokens: { totalTokens: 10 },
      durationMs: 100,
      droppedRelevantRecommendationCount: 0,
      droppedRelevantLinkedCount: 0,
      droppedRelevantCoverageCount: 0,
    };
    const passing = Array.from({ length: 24 }, () => ({ ...observation }));
    expect(evaluateProviderShadowReview(contract, passing).passed).toBe(true);
    passing[0] = { ...observation, recallBasisPoints: 5000 };
    expect(evaluateProviderShadowReview(contract, passing).passed).toBe(false);
    expect(
      evaluateProviderShadowReview(contract, [], {
        failureCode: "provider_shadow_result_invalid",
        providerInvocationCount: 1,
      }),
    ).toMatchObject({
      passed: false,
      providerInvocationCount: 1,
      invalidResultCount: 1,
      stoppedFailureCode: "provider_shadow_result_invalid",
    });
  });
});
