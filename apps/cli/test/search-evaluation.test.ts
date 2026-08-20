import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { serializeYaml } from "@lervo/project";
import type { DocumentManifest } from "@lervo/schemas";
import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";

const roots: string[] = [];

function manifest(): DocumentManifest {
  return {
    schemaVersion: 1,
    documentId: "doc_search_eval_guide",
    record: {
      path: "docs/search-evaluation.md",
      kind: "canonical",
      responsibleParty: { kind: "team", id: "platform" },
      connectedPaths: ["packages/search"],
      verifiedRevision: "fixture-v1",
      verifiedAt: "2026-08-20T00:00:00.000Z",
      reviewIntervalDays: 30,
      ownership: { mode: "user" },
    },
    contentPolicy: {
      mode: "user_managed",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "search/evaluation",
      locale: "ko-KR",
      audience: "human",
      metadataPlacement: "sidecar",
      historyMode: "separate_documents",
      splitStrategy: "topic_documents",
      automaticWrites: false,
      splitRecommendedAtBytes: 32768,
      oversizeReviewAtBytes: 65536,
      overflowAction: "report_split_recommended",
    },
    relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
  };
}

async function repository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-search-evaluation-cli-"));
  roots.push(root);
  expect(await runCli(["init"], { cwd: root, stdout: () => undefined, stderr: () => undefined })).toBe(0);
  await mkdir(resolve(root, "docs"));
  await writeFile(
    resolve(root, "docs/search-evaluation.md"),
    "# 운영 안내\n\n검색 실패는 사람이 직접 평가합니다.\n",
  );
  await writeFile(
    resolve(root, ".lervo/documents/doc_search_eval_guide.yaml"),
    serializeYaml(manifest()),
  );
  return root;
}

async function jsonCommand(root: string, args: string[]): Promise<{ code: number; output: string; error: string }> {
  let output = "";
  let error = "";
  const code = await runCli(args, {
    cwd: root,
    stdout: (message) => { output += message; },
    stderr: (message) => { error += message; },
  });
  return { code, output, error };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("lervo search reusable evaluation", () => {
  it("records one reviewed case per file and detects a later lexical regression", async () => {
    const root = await repository();
    const query = "검색 실패는 사람이 직접 평가합니다";
    const searched = await jsonCommand(root, ["search", query, "--json"]);
    expect(searched.code, searched.error).toBe(0);
    const attemptId = (JSON.parse(searched.output) as { attemptId: string }).attemptId;

    const assessed = await jsonCommand(root, [
      "search", "assess", attemptId, "--outcome", "accepted",
      "--selected", "document:doc_search_eval_guide",
      "--expected", "document:doc_search_eval_guide", "--json",
    ]);
    expect(assessed.code, assessed.error).toBe(0);

    const created = await jsonCommand(root, [
      "search", "case", attemptId, "--query", query, "--maximum-rank", "3", "--json",
    ]);
    expect(created.code, created.error).toBe(0);
    const evaluationCase = JSON.parse(created.output) as { caseId: string };
    const casePath = resolve(root, ".lervo/search-evaluations", `${evaluationCase.caseId}.yaml`);
    expect(await readFile(casePath, "utf8")).toContain(query);
    expect((await stat(casePath)).mode & 0o777).toBe(0o600);

    const passing = await jsonCommand(root, ["search", "evaluate", "--json"]);
    expect(passing.code, passing.error).toBe(0);
    expect(JSON.parse(passing.output).run).toMatchObject({ passedCases: 1, failedCases: 0, regressions: 0 });
    expect(passing.output).not.toContain(query);

    await writeFile(resolve(root, "docs/search-evaluation.md"), "# 전혀 다른 안내\n\n관련 없는 내용입니다.\n");
    const regressed = await jsonCommand(root, ["search", "evaluate", "--json"]);
    expect(regressed.code).toBe(1);
    expect(regressed.error).toBe("");
    expect(JSON.parse(regressed.output).run).toMatchObject({
      failedCases: 1,
      regressions: 1,
      embeddingDecision: "not_determined",
    });

    const resultFiles = await readdir(resolve(root, ".lervo/state/search/evaluation-results"));
    const runFiles = await readdir(resolve(root, ".lervo/state/search/evaluation-runs"));
    expect(resultFiles).toHaveLength(2);
    expect(runFiles).toHaveLength(2);
    const state = await Promise.all([
      ...resultFiles.map((name) => readFile(resolve(root, ".lervo/state/search/evaluation-results", name), "utf8")),
      ...runFiles.map((name) => readFile(resolve(root, ".lervo/state/search/evaluation-runs", name), "utf8")),
    ]);
    expect(state.join("\n")).not.toContain(query);
  });

  it("does not invent a reusable answer for a failed assessment without an expected source", async () => {
    const root = await repository();
    const query = "존재하지 않는 검색어";
    const searched = await jsonCommand(root, ["search", query, "--json"]);
    const attemptId = (JSON.parse(searched.output) as { attemptId: string }).attemptId;
    expect((await jsonCommand(root, [
      "search", "assess", attemptId, "--outcome", "failed", "--reason", "no_results",
    ])).code).toBe(0);

    const created = await jsonCommand(root, ["search", "case", attemptId, "--query", query]);
    expect(created.code).toBe(1);
    expect(created.error).toContain("평가자가 기대하거나 수락한 원본만");
    await expect(access(resolve(root, ".lervo/search-evaluations"))).resolves.toBeUndefined();
    expect(await readdir(resolve(root, ".lervo/search-evaluations"))).toEqual([]);
  });

  it("rejects a changed case instead of publishing a partial evaluation run", async () => {
    const root = await repository();
    const query = "검색 실패는 사람이 직접 평가합니다";
    const searched = await jsonCommand(root, ["search", query, "--json"]);
    const attemptId = (JSON.parse(searched.output) as { attemptId: string }).attemptId;
    expect((await jsonCommand(root, [
      "search", "assess", attemptId, "--outcome", "accepted",
      "--selected", "document:doc_search_eval_guide",
    ])).code).toBe(0);
    const created = await jsonCommand(root, [
      "search", "case", attemptId, "--query", query, "--maximum-rank", "3", "--json",
    ]);
    const caseId = (JSON.parse(created.output) as { caseId: string }).caseId;
    const casePath = resolve(root, ".lervo/search-evaluations", `${caseId}.yaml`);
    await writeFile(casePath, (await readFile(casePath, "utf8")).replace("maximumRank: 3", "maximumRank: 4"));

    const evaluated = await jsonCommand(root, ["search", "evaluate"]);
    expect(evaluated.code).toBe(1);
    expect(evaluated.error).toContain("evaluation_case_invalid");
    await expect(access(resolve(root, ".lervo/state/search/evaluation-results"))).rejects.toThrow();
    await expect(access(resolve(root, ".lervo/state/search/evaluation-runs"))).rejects.toThrow();
  });
});
