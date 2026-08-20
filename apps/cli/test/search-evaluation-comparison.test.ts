import { readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import {
  reviewLocalSearchCandidate,
  runLocalSearchEvaluationComparison,
} from "@lervo/search-local";
import { afterEach, describe, expect, it } from "vitest";

import {
  bundle,
  candidateEngine,
  cleanupSearchComparisonRepositories,
  command,
  observationEntries,
  recoveringCandidateEngine,
  repository,
  reviewedCase,
} from "./search-evaluation-comparison-fixture.js";

afterEach(cleanupSearchComparisonRepositories);

describe("local search evaluation candidate comparison", () => {
  it("lists the allowlisted candidate and compares a ready bundle through the CLI", async () => {
    const root = await repository();
    const cases = [await reviewedCase(root, "작은 파일"), await reviewedCase(root, "검색 맥락")];
    await bundle(root, "researcher.cli", 2, cases);

    const listed = await command(root, ["search", "candidates", "--json"]);
    expect(listed.code, listed.error).toBe(0);
    expect(JSON.parse(listed.output)).toEqual({
      candidates: [{ candidateId: "bm25f-v1", engine: { id: "bm25f", version: 1 } }],
    });

    const compared = await command(root, [
      "search", "compare", "researcher.cli", "--candidate", "bm25f-v1", "--json",
    ]);
    expect(compared.code, compared.error).toBe(0);
    const comparisonOutput = JSON.parse(compared.output) as {
      comparison: { comparisonId: string };
    };
    expect(comparisonOutput).toMatchObject({
      comparison: {
        bundleId: "researcher.cli",
        baseline: { engine: { id: "lexical", version: 1 } },
        candidate: { engine: { id: "bm25f", version: 1 } },
        candidateDecision: "not_determined",
        embeddingDecision: "not_determined",
      },
    });
    expect(compared.output).not.toContain("검색 맥락");
    expect(await readdir(resolve(root, ".lervo/state/search/evaluation-comparisons"))).toHaveLength(1);

    const reviewed = await command(root, [
      "search", "review", comparisonOutput.comparison.comparisonId,
      "--decision", "more-samples", "--reviewer", "reviewer_search", "--json",
    ]);
    expect(reviewed.code, reviewed.error).toBe(0);
    const reviewOutput = JSON.parse(reviewed.output) as { reviewId: string };
    expect(reviewOutput).toMatchObject({
      comparisonId: comparisonOutput.comparison.comparisonId,
      candidateId: "bm25f-v1",
      decision: "more_samples_required",
      verification: { comparisonIntegrity: "verified", candidateReplay: "matched" },
      promotionReadiness: "more_evidence_required",
      activationState: "not_applied",
      embeddingDecision: "not_determined",
    });
    expect(reviewed.output).not.toContain("검색 맥락");
    expect(await readdir(resolve(root, ".lervo/state/search/evaluation-reviews"))).toHaveLength(1);

    const policyCreated = await command(root, [
      "search", "engine", "policy", "create",
      "--reviewer", "reviewer_search", "--operator", "operator_search",
      "--author", "operator_search", "--candidate", "bm25f-v1", "--json",
    ]);
    expect(policyCreated.code, policyCreated.error).toBe(0);
    const policyId = (JSON.parse(policyCreated.output) as { policyId: string }).policyId;
    expect(await readdir(resolve(root, ".lervo/search-engine-policies"))).toEqual([`${policyId}.yaml`]);

    const ineligibleActivation = await command(root, [
      "search", "engine", "activate", reviewOutput.reviewId,
      "--policy", policyId, "--operator", "operator_search",
    ]);
    expect(ineligibleActivation.code).toBe(1);
    expect(ineligibleActivation.error).toContain("engine_activation_not_eligible");
    expect(await observationEntries(root)).not.toContain("engine-selections");

    const status = await command(root, ["search", "engine", "status", "--json"]);
    expect(status.code, status.error).toBe(0);
    expect(JSON.parse(status.output)).toEqual({
      selection: {
        mode: "baseline",
        candidateId: null,
        engine: { id: "lexical", version: 1 },
        reviewId: null,
        comparisonId: null,
      },
      selectionTransitionId: null,
      transitions: 0,
      resolverState: "ready",
      failureCode: null,
    });

    const unsupportedAdoption = await command(root, [
      "search", "review", comparisonOutput.comparison.comparisonId,
      "--decision", "adopt", "--reviewer", "reviewer_search",
    ]);
    expect(unsupportedAdoption.code).toBe(1);
    expect(unsupportedAdoption.error).toContain("candidate_review_not_eligible");
    expect(await readdir(resolve(root, ".lervo/state/search/evaluation-reviews"))).toHaveLength(1);

    const unknown = await command(root, [
      "search", "compare", "researcher.cli", "--candidate", "module:/tmp/candidate.js",
    ]);
    expect(unknown.code).toBe(1);
    expect(unknown.error).toContain("evaluation_candidate_not_registered");
  });

  it("records two engine runs and publishes the query-free comparison last", async () => {
    const root = await repository();
    const cases = [await reviewedCase(root, "작은 파일"), await reviewedCase(root, "검색 맥락")];
    await bundle(root, "researcher.discovery", 2, cases);
    const project = await loadProjectManifest(root);
    let builds = 0;

    const output = await runLocalSearchEvaluationComparison({
      repositoryRoot: root,
      projectId: project.projectId,
      bundleId: "researcher.discovery",
      candidateEngine: candidateEngine(() => { builds += 1; }),
      evaluatedAt: new Date("2026-08-20T04:00:00.000Z"),
    });

    expect(builds).toBe(1);
    expect(output.comparison).toMatchObject({
      totalCases: 2,
      baselineWins: 0,
      candidateWins: 0,
      ties: 2,
      observedOutcome: "no_difference_observed",
      candidateDecision: "not_determined",
      embeddingDecision: "not_determined",
    });
    expect(await readdir(resolve(root, ".lervo/state/search/evaluation-runs"))).toHaveLength(2);
    expect(await readdir(resolve(root, ".lervo/state/search/evaluation-results"))).toHaveLength(4);
    const comparisonFiles = await readdir(resolve(root, ".lervo/state/search/evaluation-comparisons"));
    expect(comparisonFiles).toEqual([`${output.comparison.comparisonId}.json`]);
    expect(JSON.stringify(output.comparison)).not.toContain("검색 맥락");
  });

  it("does not build the candidate or create evaluation artifacts for insufficient samples", async () => {
    const root = await repository();
    const cases = [await reviewedCase(root, "검색 맥락")];
    await bundle(root, "designer.review", 2, cases);
    const project = await loadProjectManifest(root);
    let builds = 0;
    await rm(resolve(root, "docs/search-context.md"));

    await expect(runLocalSearchEvaluationComparison({
      repositoryRoot: root,
      projectId: project.projectId,
      bundleId: "designer.review",
      candidateEngine: candidateEngine(() => { builds += 1; }),
      evaluatedAt: new Date("2026-08-20T04:01:00.000Z"),
    })).rejects.toMatchObject({ code: "evaluation_comparison_not_ready" });

    expect(builds).toBe(0);
    expect(await observationEntries(root)).not.toContain("evaluation-comparisons");
    expect(await observationEntries(root)).not.toContain("evaluation-runs");
    expect(await observationEntries(root)).not.toContain("evaluation-results");

    const cliResult = await command(root, [
      "search", "compare", "designer.review", "--candidate", "bm25f-v1",
    ]);
    expect(cliResult.code).toBe(1);
    expect(cliResult.error).toContain("evaluation_comparison_not_ready");
    expect(await observationEntries(root)).not.toContain("evaluation-comparisons");
  });

  it("publishes no evaluation artifacts when the candidate response breaks its index contract", async () => {
    const root = await repository();
    const cases = [await reviewedCase(root, "작은 파일")];
    await bundle(root, "marketer.claims", 1, cases);
    const project = await loadProjectManifest(root);

    await expect(runLocalSearchEvaluationComparison({
      repositoryRoot: root,
      projectId: project.projectId,
      bundleId: "marketer.claims",
      candidateEngine: candidateEngine(() => {}, true),
      evaluatedAt: new Date("2026-08-20T04:02:00.000Z"),
    })).rejects.toMatchObject({ code: "evaluation_candidate_failed" });

    expect(await observationEntries(root)).not.toContain("evaluation-comparisons");
    expect(await observationEntries(root)).not.toContain("evaluation-runs");
    expect(await observationEntries(root)).not.toContain("evaluation-results");
  });

  it("reverifies the stored comparison, replays a winning candidate, and stores adoption without activation", async () => {
    const root = await repository();
    const cases = [await reviewedCase(root, "검색 맥락")];
    await bundle(root, "researcher.recovery", 1, cases);
    await writeFile(resolve(root, "docs/search-context.md"), "# 다른 문서\n\n평가 질의와 무관한 현재 내용입니다.\n");
    const project = await loadProjectManifest(root);
    const engine = recoveringCandidateEngine("검색 맥락", "doc_cli_search_context");
    const compared = await runLocalSearchEvaluationComparison({
      repositoryRoot: root,
      projectId: project.projectId,
      bundleId: "researcher.recovery",
      candidateEngine: engine,
      evaluatedAt: new Date("2026-08-20T04:03:00.000Z"),
    });
    expect(compared.comparison).toMatchObject({ baselineWins: 0, candidateWins: 1, ties: 0 });

    const review = await reviewLocalSearchCandidate({
      repositoryRoot: root,
      projectId: project.projectId,
      comparisonId: compared.comparison.comparisonId,
      registration: { candidateId: "fixture-v1", engine },
      reviewerId: "reviewer_search",
      reviewedAt: new Date("2026-08-20T05:00:00.000Z"),
      decision: "adopt_candidate",
    });

    expect(review).toMatchObject({
      decision: "adopt_candidate",
      promotionReadiness: "eligible_for_activation_review",
      verification: { comparisonIntegrity: "verified", candidateReplay: "matched" },
      activationState: "not_applied",
    });
    expect(await readdir(resolve(root, ".lervo/state/search/evaluation-reviews")))
      .toEqual([`${review.reviewId}.json`]);
  });

  it("does not publish a review when the current corpus no longer matches the comparison", async () => {
    const root = await repository();
    const cases = [await reviewedCase(root, "검색 맥락")];
    await bundle(root, "researcher.changed-corpus", 1, cases);
    const compared = await command(root, [
      "search", "compare", "researcher.changed-corpus", "--candidate", "bm25f-v1", "--json",
    ]);
    expect(compared.code, compared.error).toBe(0);
    const comparisonId = (JSON.parse(compared.output) as { comparison: { comparisonId: string } })
      .comparison.comparisonId;
    await writeFile(resolve(root, "docs/search-context.md"), "# 비교 뒤 바뀐 문서\n\n현재 corpus가 다릅니다.\n");

    const reviewed = await command(root, [
      "search", "review", comparisonId,
      "--decision", "reject", "--reviewer", "reviewer_search",
    ]);

    expect(reviewed.code).toBe(1);
    expect(reviewed.error).toContain("invalid_evaluation_comparison");
    expect(await observationEntries(root)).not.toContain("evaluation-reviews");
  });
});
