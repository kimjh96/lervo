import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import {
  createSearchAssessment,
  createSearchAttempt,
  createSearchEngineActivationPolicy,
  SearchEvaluationEngineRegistry,
} from "@lervo/search";
import {
  activateLocalSearchCandidate,
  LocalSearchObservationStore,
  recordSearchEngineActivationPolicy,
  reviewLocalSearchCandidate,
  runLocalOperationalSearch,
  runLocalSearchEvaluationComparison,
} from "@lervo/search-local";
import { afterEach, describe, expect, it } from "vitest";

import {
  bundle,
  CANDIDATE_ADAPTER_BUILD_ID,
  cleanupSearchComparisonRepositories,
  command,
  recoveringCandidateEngine,
  repository,
  reviewedCase,
} from "./search-evaluation-comparison-fixture.js";

afterEach(cleanupSearchComparisonRepositories);

describe("selection-bound search quality report", () => {
  it("groups explicit assessments by implicit baseline and the verified candidate build", async () => {
    const root = await repository();
    const cases = [await reviewedCase(root, "검색 맥락")];
    await bundle(root, "researcher.quality", 1, cases);
    const comparedDocument = "# 다른 문서\n\n평가 질의와 무관한 현재 내용입니다.\n";
    await writeFile(resolve(root, "docs/search-context.md"), comparedDocument);
    const project = await loadProjectManifest(root);
    const engine = recoveringCandidateEngine("검색 맥락", "doc_cli_search_context");
    const registry = new SearchEvaluationEngineRegistry([{ candidateId: "fixture-v1", engine }]);
    const baseline = await runLocalOperationalSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry,
      query: "평가 질의",
      limit: 5,
    });
    const baselineAttempt = createSearchAttempt({
      projectId: project.projectId,
      observedAt: new Date("2026-08-20T08:00:00.000Z"),
      nonce: "b".repeat(32),
      response: baseline.response,
      selectionTransitionId: baseline.selectionTransitionId,
    });
    const compared = await runLocalSearchEvaluationComparison({
      repositoryRoot: root,
      projectId: project.projectId,
      bundleId: "researcher.quality",
      candidateEngine: engine,
      evaluatedAt: new Date("2026-08-20T09:00:00.000Z"),
    });
    const review = await reviewLocalSearchCandidate({
      repositoryRoot: root,
      projectId: project.projectId,
      comparisonId: compared.comparison.comparisonId,
      registration: { candidateId: "fixture-v1", engine },
      reviewerId: "reviewer_search",
      reviewedAt: new Date("2026-08-20T09:30:00.000Z"),
      decision: "adopt_candidate",
    });
    const policy = createSearchEngineActivationPolicy({
      projectId: project.projectId,
      allowedReviewerIds: ["reviewer_search"],
      allowedOperatorIds: ["operator_search"],
      allowedCandidateIds: ["fixture-v1"],
      minimumCandidateWins: 1,
      authoredBy: "operator_search",
      createdAt: new Date("2026-08-20T09:45:00.000Z"),
    });
    await recordSearchEngineActivationPolicy(root, policy);
    const activation = await activateLocalSearchCandidate({
      repositoryRoot: root,
      projectId: project.projectId,
      reviewId: review.reviewId,
      policyId: policy.policyId,
      operatorId: "operator_search",
      decidedAt: new Date("2026-08-20T10:00:00.000Z"),
      registry,
    });
    const candidate = await runLocalOperationalSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry,
      query: "검색 맥락",
      limit: 5,
    });
    const candidateAttempt = createSearchAttempt({
      projectId: project.projectId,
      observedAt: new Date("2026-08-20T10:01:00.000Z"),
      nonce: "c".repeat(32),
      response: candidate.response,
      selectionTransitionId: candidate.selectionTransitionId,
    });
    const assessment = createSearchAssessment({
      attempt: candidateAttempt,
      assessedAt: new Date("2026-08-20T10:02:00.000Z"),
      assessor: "human",
      outcome: "accepted",
      selectedSources: [{
        sourceKind: candidateAttempt.hits[0]!.sourceKind,
        sourceId: candidateAttempt.hits[0]!.sourceId,
      }],
    });
    const store = await LocalSearchObservationStore.open(root);
    await store.recordAttempt(baselineAttempt);
    await store.recordAttempt(candidateAttempt);
    await store.recordAssessment(assessment);

    const reported = await command(root, ["search", "report", "--json"]);
    expect(reported.code, reported.error).toBe(0);
    expect(JSON.parse(reported.output)).toMatchObject({
      schemaVersion: 2,
      totalAttempts: 3,
      assessedAttempts: 2,
      rolloutDecision: "not_determined",
      rollbackDecision: "not_determined",
      selections: [{
        selectionTransitionId: null,
        selectionState: "implicit_baseline",
        adapterBuildId: null,
        totalAttempts: 2,
        assessedAttempts: 1,
        acceptedAttempts: 1,
        evidenceState: "no_failures_observed",
      }, {
        selectionTransitionId: activation.activationId,
        selectionState: "candidate",
        adapterBuildId: CANDIDATE_ADAPTER_BUILD_ID,
        totalAttempts: 1,
        assessedAttempts: 1,
        acceptedAttempts: 1,
        evidenceState: "no_failures_observed",
      }],
    });
    expect(reported.output).not.toContain("검색 맥락");
    expect(reported.output).not.toContain("docs/search-context.md");

    const rolledBack = await command(root, [
      "search", "engine", "rollback", "--policy", policy.policyId,
      "--operator", "operator_search", "--json",
    ]);
    expect(rolledBack.code, rolledBack.error).toBe(0);
    const rollbackId = (JSON.parse(rolledBack.output) as { activationId: string }).activationId;
    const searched = await command(root, ["search", "평가 질의", "--json"]);
    expect(searched.code, searched.error).toBe(0);
    const afterRollback = await command(root, ["search", "report", "--json"]);
    expect(afterRollback.code, afterRollback.error).toBe(0);
    expect((JSON.parse(afterRollback.output) as { selections: unknown[] }).selections)
      .toEqual(expect.arrayContaining([expect.objectContaining({
        selectionTransitionId: rollbackId,
        selectionState: "recorded_baseline",
        adapterBuildId: null,
        totalAttempts: 1,
        assessedAttempts: 0,
        evidenceState: "insufficient_assessment",
      })]));
  });
});
