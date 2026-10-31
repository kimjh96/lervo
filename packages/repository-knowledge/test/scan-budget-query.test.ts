import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, expect, it, vi } from "vitest";

import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  defaultRepositoryKnowledgePolicy,
  queryRepositoryKnowledge,
  RepositoryKnowledgeQueryIndex,
  scanConfiguredRepositoryKnowledge,
} from "../src/index.js";
import * as publicationFiles from "../src/repository-publication-files.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function registeredRepository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-budget-query-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_budgetquery" }));
  await mkdir(resolve(root, "docs/specifications"), { recursive: true });
  await writeFile(resolve(root, "README.md"), "# Repository\n");
  const path = "docs/specifications/runtime.md";
  await writeFile(
    resolve(root, path),
    "# Cobaltmaintenance\n\nKeep cobaltmaintenance observable.\n",
  );
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root }),
    new Date(),
    () => undefined,
  );
  const { scan } = await scanConfiguredRepositoryKnowledge(root);
  const budget = scan.inventoryCoverage.includedBytes + 4096;
  await writeFile(
    resolve(root, ".lervo/knowledge/policy.yaml"),
    JSON.stringify({
      ...defaultRepositoryKnowledgePolicy,
      limits: { ...defaultRepositoryKnowledgePolicy.limits, maxTotalBytes: budget },
    }),
  );
  return { root, path, budget };
}

it("never rereads a registered publication skipped by budget admission", async () => {
  const { root, path, budget } = await registeredRepository();
  expect(
    (
      await queryRepositoryKnowledge({ repositoryRoot: root, query: "cobaltmaintenance" })
    ).hits.some((hit) => hit.path === path),
  ).toBe(true);
  await writeFile(resolve(root, path), "# Cobaltmaintenance\n".padEnd(budget * 2, "r"));
  const { scan } = await scanConfiguredRepositoryKnowledge(root);
  expect(scan.sources.find((source) => source.path === path)?.reason).toBe("total_budget_exceeded");
  const read = vi.spyOn(publicationFiles, "readSafePublication");
  const result = await queryRepositoryKnowledge({
    repositoryRoot: root,
    query: "cobaltmaintenance",
  });
  expect(result.coverage).toBe("partial");
  expect(result.hits.some((hit) => hit.path === path)).toBe(false);
  expect(read.mock.calls.some(([, requestedPath]) => requestedPath === path)).toBe(false);
});

it("restores complete query coverage from warm caches after the skipped source fits", async () => {
  const { root, path, budget } = await registeredRepository();
  await writeFile(resolve(root, path), "# Cobaltmaintenance\n".padEnd(budget * 2, "r"));
  const partial = await queryRepositoryKnowledge({
    repositoryRoot: root,
    query: "cobaltmaintenance",
  });
  expect(partial.coverage).toBe("partial");
  await writeFile(resolve(root, path), "# Cobaltmaintenance\n\nComplete again.\n");
  const warm = await queryRepositoryKnowledge({ repositoryRoot: root, query: "cobaltmaintenance" });
  const cold = (
    await RepositoryKnowledgeQueryIndex.prepare({
      repositoryRoot: root,
      preparationCache: "disabled",
    })
  ).query({ query: "cobaltmaintenance" });
  expect(warm.coverage).toBe("complete");
  expect(warm.skippedForBudget.count).toBe(0);
  expect(warm.hits.some((hit) => hit.path === path)).toBe(true);
  expect(warm).toEqual(cold);
});
