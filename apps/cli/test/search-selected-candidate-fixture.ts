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

import {
  bundle,
  recoveringCandidateEngine,
  repository,
  reviewedCase,
} from "./search-evaluation-comparison-fixture.js";

export async function prepareSelectedSearchCandidate(scope: string) {
  const root = await repository();
  const cases = [await reviewedCase(root, "검색 맥락")];
  await bundle(root, scope, 1, cases);
  await writeFile(
    resolve(root, "docs/search-context.md"),
    "# 다른 문서\n\n평가 질의와 무관한 현재 내용입니다.\n",
  );
  const project = await loadProjectManifest(root);
  const engine = recoveringCandidateEngine("검색 맥락", "doc_cli_search_context");
  const registry = new SearchEvaluationEngineRegistry([{ candidateId: "fixture-v1", engine }]);
  const compared = await runLocalSearchEvaluationComparison({
    repositoryRoot: root,
    projectId: project.projectId,
    bundleId: scope,
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
  await store.recordAttempt(candidateAttempt);
  await store.recordAssessment(assessment);
  return { root, project, activation, policy, registry };
}
