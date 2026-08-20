import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/main.js";
import { registerSearchContextDocument } from "./search-context-fixture.js";

const roots: string[] = [];

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
  const root = await mkdtemp(resolve(tmpdir(), "lervo-search-bundle-cli-"));
  roots.push(root);
  expect((await command(root, ["init"])).code).toBe(0);
  await registerSearchContextDocument(root);
  return root;
}

async function reviewedCase(root: string, query: string): Promise<string> {
  const searched = await command(root, ["search", query, "--json"]);
  expect(searched.code, searched.error).toBe(0);
  const attemptId = (JSON.parse(searched.output) as { attemptId: string }).attemptId;
  const assessed = await command(root, [
    "search", "assess", attemptId, "--outcome", "accepted",
    "--selected", "document:doc_cli_search_context",
  ]);
  expect(assessed.code, assessed.error).toBe(0);
  const created = await command(root, ["search", "case", attemptId, "--query", query, "--json"]);
  expect(created.code, created.error).toBe(0);
  return (JSON.parse(created.output) as { caseId: string }).caseId;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("lervo search evaluation bundles", () => {
  it("selects only active replacements and separates sufficient from insufficient samples", async () => {
    const root = await repository();
    const oldCaseId = await reviewedCase(root, "작은 파일");
    const activeCaseId = await reviewedCase(root, "검색 맥락");

    const sufficient = await command(root, [
      "search", "bundle", "create", "researcher.discovery",
      "--role", "researcher", "--task-type", "source-discovery", "--minimum-cases", "1",
      "--case", activeCaseId, "--replace", `${oldCaseId}:${activeCaseId}`, "--json",
    ]);
    expect(sufficient.code, sufficient.error).toBe(0);
    expect(JSON.parse(sufficient.output)).toMatchObject({
      bundleId: "researcher.discovery",
      activeCaseIds: [activeCaseId],
      replacements: [{ replacedCaseId: oldCaseId, replacementCaseId: activeCaseId }],
    });
    expect(sufficient.output).not.toContain("검색 맥락");

    const insufficient = await command(root, [
      "search", "bundle", "create", "designer.context",
      "--role", "designer", "--task-type", "context-review", "--minimum-cases", "2",
      "--case", activeCaseId,
    ]);
    expect(insufficient.code, insufficient.error).toBe(0);

    const readyReport = await command(root, [
      "search", "bundle", "report", "researcher.discovery", "--json",
    ]);
    expect(readyReport.code, readyReport.error).toBe(0);
    expect(JSON.parse(readyReport.output).coverages[0]).toMatchObject({
      activeCases: 1,
      shortfall: 0,
      sampleState: "sufficient",
      comparisonReadiness: "ready",
      embeddingDecision: "not_determined",
    });

    const blockedReport = await command(root, [
      "search", "bundle", "report", "designer.context", "--json",
    ]);
    expect(blockedReport.code).toBe(1);
    expect(blockedReport.error).toBe("");
    expect(JSON.parse(blockedReport.output).coverages[0]).toMatchObject({
      activeCases: 1,
      shortfall: 1,
      sampleState: "insufficient",
      comparisonReadiness: "insufficient_sample",
    });

    const insufficientEvaluation = await command(root, [
      "search", "evaluate", "--bundle", "designer.context", "--json",
    ]);
    expect(insufficientEvaluation.code).toBe(1);
    expect(insufficientEvaluation.error).toBe("");
    expect(JSON.parse(insufficientEvaluation.output)).toMatchObject({
      coverage: { sampleState: "insufficient", comparisonReadiness: "insufficient_sample" },
      run: { caseIds: [activeCaseId] },
    });

    const evaluated = await command(root, [
      "search", "evaluate", "--bundle", "researcher.discovery", "--json",
    ]);
    expect(evaluated.code, evaluated.error).toBe(0);
    const evaluation = JSON.parse(evaluated.output) as {
      coverage: { activeCaseIds: string[] };
      run: { caseIds: string[] };
      results: unknown[];
    };
    expect(evaluation.coverage.activeCaseIds).toEqual([activeCaseId]);
    expect(evaluation.run.caseIds).toEqual([activeCaseId]);
    expect(evaluation.results).toHaveLength(1);
    expect(evaluated.output).not.toContain("검색 맥락");

    const bundleFiles = (await readdir(resolve(root, ".lervo/search-evaluations")))
      .filter((name) => name.endsWith(".bundle.yaml"));
    expect(bundleFiles).toEqual(["designer.context.bundle.yaml", "researcher.discovery.bundle.yaml"]);
  });

  it("rejects a replacement cycle and a duplicate role/task scope", async () => {
    const root = await repository();
    const first = await reviewedCase(root, "작은 파일");
    const second = await reviewedCase(root, "검색 맥락");
    const cyclic = await command(root, [
      "search", "bundle", "create", "general.cycle",
      "--role", "general", "--task-type", "cycle", "--minimum-cases", "1",
      "--replace", `${first}:${second}`, "--replace", `${second}:${first}`,
    ]);
    expect(cyclic.code).toBe(1);
    expect(cyclic.error).toContain("순환");

    expect((await command(root, [
      "search", "bundle", "create", "general.primary",
      "--role", "general", "--task-type", "review", "--minimum-cases", "1", "--case", first,
    ])).code).toBe(0);
    const duplicate = await command(root, [
      "search", "bundle", "create", "general.secondary",
      "--role", "general", "--task-type", "review", "--minimum-cases", "1", "--case", second,
    ]);
    expect(duplicate.code).toBe(1);
    expect(duplicate.error).toContain("같은 역할·작업 유형");
  });
});
