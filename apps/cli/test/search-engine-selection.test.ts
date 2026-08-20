import { readdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import {
  contentId,
  createSearchEngineActivationPolicy,
  SearchEvaluationEngineRegistry,
} from "@lervo/search";
import {
  activateLocalSearchCandidate,
  refreshLocalSearchCandidate,
  recordSearchEngineActivationPolicy,
  reviewLocalSearchCandidate,
  runLocalOperationalSearch,
  runLocalSearchEvaluationComparison,
} from "@lervo/search-local";
import { afterEach, describe, expect, it } from "vitest";

import { prepareManagedSearchContext } from "../src/managed-search-context.js";
import {
  bundle,
  CANDIDATE_ENGINE,
  cleanupSearchComparisonRepositories,
  command,
  observationEntries,
  recoveringCandidateEngine,
  repository,
  reviewedCase,
} from "./search-evaluation-comparison-fixture.js";

afterEach(cleanupSearchComparisonRepositories);

describe("operational search engine selection", () => {
  it("uses a verified selection once, reports failure, and restores baseline on rollback", async () => {
    const root = await repository();
    const cases = [await reviewedCase(root, "검색 맥락")];
    await bundle(root, "researcher.activation", 1, cases);
    const comparedDocument = "# 다른 문서\n\n평가 질의와 무관한 현재 내용입니다.\n";
    await writeFile(resolve(root, "docs/search-context.md"), comparedDocument);
    const project = await loadProjectManifest(root);
    let candidateBuilds = 0;
    const engine = recoveringCandidateEngine(
      "검색 맥락",
      "doc_cli_search_context",
      () => { candidateBuilds += 1; },
    );
    const registry = new SearchEvaluationEngineRegistry([{ candidateId: "fixture-v1", engine }]);
    const compared = await runLocalSearchEvaluationComparison({
      repositoryRoot: root,
      projectId: project.projectId,
      bundleId: "researcher.activation",
      candidateEngine: engine,
      evaluatedAt: new Date("2026-08-20T08:00:00.000Z"),
    });
    const review = await reviewLocalSearchCandidate({
      repositoryRoot: root,
      projectId: project.projectId,
      comparisonId: compared.comparison.comparisonId,
      registration: { candidateId: "fixture-v1", engine },
      reviewerId: "reviewer_search",
      reviewedAt: new Date("2026-08-20T09:00:00.000Z"),
      decision: "adopt_candidate",
    });
    const policy = createSearchEngineActivationPolicy({
      projectId: project.projectId,
      allowedReviewerIds: ["reviewer_search"],
      allowedOperatorIds: ["operator_search"],
      allowedCandidateIds: ["fixture-v1"],
      minimumCandidateWins: 1,
      authoredBy: "operator_search",
      createdAt: new Date("2026-08-20T09:30:00.000Z"),
    });
    await recordSearchEngineActivationPolicy(root, policy);
    await writeFile(resolve(root, "docs/search-context.md"), "# 검토 뒤 변경\n\n현재 corpus가 달라졌습니다.\n");
    await expect(activateLocalSearchCandidate({
      repositoryRoot: root,
      projectId: project.projectId,
      reviewId: review.reviewId,
      policyId: policy.policyId,
      operatorId: "operator_search",
      decidedAt: new Date("2026-08-20T09:59:00.000Z"),
      registry,
    })).rejects.toMatchObject({ code: "invalid_evaluation_comparison" });
    expect(await observationEntries(root)).not.toContain("engine-selections");
    await writeFile(resolve(root, "docs/search-context.md"), comparedDocument);
    const activation = await activateLocalSearchCandidate({
      repositoryRoot: root,
      projectId: project.projectId,
      reviewId: review.reviewId,
      policyId: policy.policyId,
      operatorId: "operator_search",
      decidedAt: new Date("2026-08-20T10:00:00.000Z"),
      registry,
    });

    expect(await readdir(resolve(root, ".lervo/state/search/engine-selections"))).toEqual(["baseline.json"]);
    const selected = await command(root, ["search", "engine", "status", "--json"]);
    expect(selected.code).toBe(1);
    expect(selected.error).toBe("");
    expect(JSON.parse(selected.output)).toMatchObject({
      selection: { mode: "candidate", candidateId: "fixture-v1" },
      selectionTransitionId: activation.activationId,
      resolverState: "unavailable",
      failureCode: "engine_selection_unavailable",
    });

    const buildsBeforeOperationalSearch = candidateBuilds;
    const operational = await runLocalOperationalSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry,
      query: "검색 맥락",
      limit: 5,
    });
    expect(operational).toMatchObject({
      selection: { mode: "candidate", candidateId: "fixture-v1" },
      selectionTransitionId: activation.activationId,
      response: { engine: CANDIDATE_ENGINE },
      verificationReceiptId: expect.stringMatching(/^sevrf_[a-f0-9]{24}$/),
    });
    expect(candidateBuilds).toBe(buildsBeforeOperationalSearch + 1);
    expect(await observationEntries(root)).not.toContain("engine-verifications");
    const buildsBeforeMismatch = candidateBuilds;
    const changedBuildRegistry = new SearchEvaluationEngineRegistry([{
      candidateId: "fixture-v1",
      engine: {
        ...engine,
        adapterBuildId: contentId("sebuild", { adapter: "fixture_candidate", revision: 2 }),
      },
    }]);
    await expect(runLocalOperationalSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry: changedBuildRegistry,
      query: "검색 맥락",
      limit: 5,
    })).rejects.toMatchObject({ code: "engine_selection_unavailable" });
    expect(candidateBuilds).toBe(buildsBeforeMismatch);
    const managed = await prepareManagedSearchContext({
      repositoryRoot: root,
      projectId: project.projectId,
      query: "검색 맥락",
      fallbackQuery: "docs/search-context.md",
      observedAt: new Date("2026-08-20T10:01:00.000Z"),
      nonce: "a".repeat(32),
      registry,
    });
    expect(managed.attempt).toMatchObject({
      engine: CANDIDATE_ENGINE,
      selectionTransitionId: activation.activationId,
    });
    expect(managed.recommendationBatch.recommendations[0]).toMatchObject({
      engine: CANDIDATE_ENGINE,
      selectionTransitionId: activation.activationId,
    });

    const unavailable = await command(root, ["search", "검색 맥락", "--json"]);
    expect(unavailable.code).toBe(1);
    expect(unavailable.error).toContain("engine_selection_unavailable");
    expect(unavailable.output).toBe("");

    await writeFile(resolve(root, "docs/search-context.md"), "# 다시 변경됨\n\n선택 뒤 corpus 변경입니다.\n");
    await expect(runLocalOperationalSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry,
      query: "검색 맥락",
      limit: 5,
    })).rejects.toMatchObject({ code: "engine_selection_unavailable" });

    const refreshedComparison = await runLocalSearchEvaluationComparison({
      repositoryRoot: root,
      projectId: project.projectId,
      bundleId: "researcher.activation",
      candidateEngine: engine,
      evaluatedAt: new Date("2026-08-20T11:00:00.000Z"),
    });
    const refreshedReview = await reviewLocalSearchCandidate({
      repositoryRoot: root,
      projectId: project.projectId,
      comparisonId: refreshedComparison.comparison.comparisonId,
      registration: { candidateId: "fixture-v1", engine },
      reviewerId: "reviewer_search",
      reviewedAt: new Date("2026-08-20T11:30:00.000Z"),
      decision: "adopt_candidate",
    });
    const unavailableRefresh = await command(root, [
      "search", "engine", "refresh", refreshedReview.reviewId,
      "--policy", policy.policyId, "--operator", "operator_search", "--json",
    ]);
    expect(unavailableRefresh.code).toBe(1);
    expect(unavailableRefresh.error).toContain("evaluation_candidate_not_registered");
    expect((await readdir(resolve(root, ".lervo/state/search/engine-selections"))))
      .toEqual(["baseline.json"]);

    const refresh = await refreshLocalSearchCandidate({
      repositoryRoot: root,
      projectId: project.projectId,
      reviewId: refreshedReview.reviewId,
      policyId: policy.policyId,
      operatorId: "operator_search",
      decidedAt: new Date("2026-08-20T12:00:00.000Z"),
      registry,
    });
    expect(refresh).toMatchObject({
      action: "refresh_candidate",
      previousActivationId: activation.activationId,
      selected: {
        mode: "candidate",
        candidateId: "fixture-v1",
        reviewId: refreshedReview.reviewId,
      },
      fallbackSelection: { mode: "baseline" },
      fallbackActivationId: null,
    });
    await expect(runLocalOperationalSearch({
      repositoryRoot: root,
      projectId: project.projectId,
      registry,
      query: "검색 맥락",
      limit: 5,
    })).resolves.toMatchObject({
      selectionTransitionId: refresh.activationId,
      response: { engine: CANDIDATE_ENGINE },
      verificationReceiptId: expect.stringMatching(/^sevrf_[a-f0-9]{24}$/),
    });

    const rolledBack = await command(root, [
      "search", "engine", "rollback", "--policy", policy.policyId,
      "--operator", "operator_search", "--json",
    ]);
    expect(rolledBack.code, rolledBack.error).toBe(0);
    expect(JSON.parse(rolledBack.output)).toMatchObject({
      action: "rollback",
      previousActivationId: refresh.activationId,
      selected: { mode: "baseline", engine: { id: "lexical", version: 1 } },
      recordState: "selection_recorded",
    });
    expect((await readdir(resolve(root, ".lervo/state/search/engine-selections"))).sort())
      .toEqual([
        `${activation.activationId}.json`,
        `${refresh.activationId}.json`,
        "baseline.json",
      ].sort());

    const searched = await command(root, ["search", "검색 맥락", "--json"]);
    expect(searched.code, searched.error).toBe(0);
    expect(JSON.parse(searched.output)).toMatchObject({
      engine: { id: "lexical", version: 1 },
      selectionTransitionId: (JSON.parse(rolledBack.output) as { activationId: string }).activationId,
    });
  });
});
