import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  RepositoryKnowledgeQueryIndex,
} from "@lervo/repository-knowledge";
import { afterEach, describe, expect, it } from "vitest";

import { productDefaultRepositoryKnowledgeRanker } from "../src/repository-knowledge-ranker.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

/** More historical documents than the engine's 50-result bound, all matching the query. */
async function repositoryWithManyHistoricalDocuments(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-query-historical-"));
  roots.push(root);
  await mkdir(resolve(root, "docs/archive"), { recursive: true });
  for (let index = 0; index < 60; index += 1)
    await writeFile(
      resolve(root, `docs/archive/replica-${String(index).padStart(2, "0")}.md`),
      `# Replica readiness note ${index}\nAn earlier replica readiness contract.\n`,
    );
  await writeFile(
    resolve(root, "README.md"),
    "# Repository replica readiness\nThe current replica readiness contract.\n",
  );
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_historicalq" }));
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root }),
    new Date("2026-11-22T00:00:00Z"),
    () => undefined,
  );
  return root;
}

describe("historical documents and the ranker's result bound", () => {
  it("answers at the engine's limit however many historical documents match", async () => {
    const root = await repositoryWithManyHistoricalDocuments();
    const index = await RepositoryKnowledgeQueryIndex.prepare({
      repositoryRoot: root,
      preparationCache: "disabled",
      ranker: productDefaultRepositoryKnowledgeRanker,
    });

    // Before the fix, the ranker was asked for the limit plus every withheld document (110).
    const current = index.query({ query: "replica readiness", limit: 50 });
    expect(current.hits[0]?.path).toBe("README.md");
    expect(current.hits.some((hit) => hit.path.startsWith("docs/archive/"))).toBe(false);

    // A query that asks for history still sees the archived documents, within the bound.
    const history = index.query({ query: "historical replica readiness", limit: 50 });
    expect(history.hits.length).toBe(50);
    expect(history.hits.some((hit) => hit.historical === true)).toBe(true);
  });
});
