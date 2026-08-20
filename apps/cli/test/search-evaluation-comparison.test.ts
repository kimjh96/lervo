import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import {
  contentId,
  LexicalSearchIndex,
  type SearchEngineIdentity,
  type SearchEvaluationEnginePort,
} from "@lervo/search";
import { runLocalSearchEvaluationComparison } from "@lervo/search-local";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { registerSearchContextDocument } from "./search-context-fixture.js";

const roots: string[] = [];
const CANDIDATE_ENGINE: SearchEngineIdentity = { id: "fixture_candidate", version: 1 };

async function command(root: string, args: string[]): Promise<{ code: number; output: string; error: string }> {
  let output = "";
  let error = "";
  const code = await runCli(args, {
    cwd: root,
    stdout: (message) => { output += message; },
    stderr: (message) => { error += message; },
  });
  return { code, output, error };
}

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-search-comparison-"));
  roots.push(root);
  expect((await command(root, ["init"])).code).toBe(0);
  await registerSearchContextDocument(root);
  return root;
}

async function reviewedCase(root: string, query: string): Promise<string> {
  const searched = await command(root, ["search", query, "--json"]);
  expect(searched.code, searched.error).toBe(0);
  const attemptId = (JSON.parse(searched.output) as { attemptId: string }).attemptId;
  expect((await command(root, [
    "search", "assess", attemptId, "--outcome", "accepted",
    "--selected", "document:doc_cli_search_context",
  ])).code).toBe(0);
  const created = await command(root, ["search", "case", attemptId, "--query", query, "--json"]);
  expect(created.code, created.error).toBe(0);
  return (JSON.parse(created.output) as { caseId: string }).caseId;
}

async function bundle(root: string, id: string, minimum: number, caseIds: string[]): Promise<void> {
  const created = await command(root, [
    "search", "bundle", "create", id,
    "--role", id.split(".")[0]!, "--task-type", id.split(".")[1]!,
    "--minimum-cases", String(minimum), ...caseIds.flatMap((caseId) => ["--case", caseId]),
  ]);
  expect(created.code, created.error).toBe(0);
}

function candidateEngine(onBuild: () => void, wrongIndex = false): SearchEvaluationEnginePort {
  return {
    engine: CANDIDATE_ENGINE,
    async buildIndex(sources) {
      onBuild();
      const lexical = new LexicalSearchIndex(sources);
      const indexId = contentId("sidx", { engine: CANDIDATE_ENGINE, corpusDigest: lexical.corpusDigest });
      return {
        engine: CANDIDATE_ENGINE,
        indexId,
        async search(query, limit) {
          return {
            ...lexical.search(query, limit),
            engine: CANDIDATE_ENGINE,
            indexId: wrongIndex ? contentId("sidx", { wrong: true }) : indexId,
          };
        },
      };
    },
  };
}

async function observationEntries(root: string): Promise<string[]> {
  return readdir(resolve(root, ".lervo/state/search"));
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("local search evaluation candidate comparison", () => {
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
});
