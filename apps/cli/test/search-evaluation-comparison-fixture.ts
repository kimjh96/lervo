import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  canonicalHash,
  contentId,
  LexicalSearchIndex,
  type SearchEngineIdentity,
  type SearchEvaluationEnginePort,
  type SearchHit,
} from "@lervo/search";
import { expect } from "vitest";

import { runCli } from "../src/main.js";
import { registerSearchContextDocument } from "./search-context-fixture.js";

const roots: string[] = [];
export const CANDIDATE_ENGINE: SearchEngineIdentity = { id: "fixture_candidate", version: 1 };
export const CANDIDATE_ADAPTER_BUILD_ID = contentId("sebuild", {
  adapter: "fixture_candidate",
  revision: 1,
});

export async function command(root: string, args: string[]): Promise<{ code: number; output: string; error: string }> {
  let output = "";
  let error = "";
  const code = await runCli(args, {
    cwd: root,
    stdout: (message) => { output += message; },
    stderr: (message) => { error += message; },
  });
  return { code, output, error };
}

export async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-search-comparison-"));
  roots.push(root);
  expect((await command(root, ["init"])).code).toBe(0);
  await registerSearchContextDocument(root);
  return root;
}

export async function reviewedCase(root: string, query: string): Promise<string> {
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

export async function bundle(root: string, id: string, minimum: number, caseIds: string[]): Promise<void> {
  const created = await command(root, [
    "search", "bundle", "create", id,
    "--role", id.split(".")[0]!, "--task-type", id.split(".")[1]!,
    "--minimum-cases", String(minimum), ...caseIds.flatMap((caseId) => ["--case", caseId]),
  ]);
  expect(created.code, created.error).toBe(0);
}

export function candidateEngine(onBuild: () => void, wrongIndex = false): SearchEvaluationEnginePort {
  return {
    engine: CANDIDATE_ENGINE,
    adapterBuildId: CANDIDATE_ADAPTER_BUILD_ID,
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

export function recoveringCandidateEngine(
  recoveredQuery: string,
  sourceId: string,
  onBuild: () => void = () => {},
): SearchEvaluationEnginePort {
  return {
    engine: CANDIDATE_ENGINE,
    adapterBuildId: CANDIDATE_ADAPTER_BUILD_ID,
    async buildIndex(sources) {
      onBuild();
      const lexical = new LexicalSearchIndex(sources);
      const indexId = contentId("sidx", { engine: CANDIDATE_ENGINE, corpusDigest: lexical.corpusDigest });
      return {
        engine: CANDIDATE_ENGINE,
        indexId,
        async search(query, limit) {
          const response = lexical.search(query, limit);
          if (query !== recoveredQuery) return { ...response, engine: CANDIDATE_ENGINE, indexId };
          const source = sources.find((item) => item.sourceId === sourceId)!;
          const hits: SearchHit[] = [{
            source: { kind: source.kind, sourceId: source.sourceId, contentHash: source.contentHash },
            rank: 1,
            score: 1,
            matchedFields: ["text"],
          }];
          return {
            ...response,
            engine: CANDIDATE_ENGINE,
            indexId,
            hits,
            resultSetHash: canonicalHash(hits.map((hit) => ({
              sourceKind: hit.source.kind,
              sourceId: hit.source.sourceId,
              contentHash: hit.source.contentHash,
              rank: hit.rank,
              score: hit.score,
            }))),
          };
        },
      };
    },
  };
}

export async function observationEntries(root: string): Promise<string[]> {
  return readdir(resolve(root, ".lervo/state/search"));
}

export async function cleanupSearchComparisonRepositories(): Promise<void> {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
}
