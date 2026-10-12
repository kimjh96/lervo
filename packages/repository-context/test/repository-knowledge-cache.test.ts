import { access, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
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
const cacheDirectory = ".lervo/state/knowledge/indexes/query-preparation";

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-query-cache-"));
  roots.push(root);
  await writeFile(
    resolve(root, "README.md"),
    "# Repository replica readiness\nExact replica reconciliation contract.\n",
  );
  await writeFile(resolve(root, "policy.md"), "# Writing policy\nHuman publication language.\n");
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_cachedquery" }));
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root }),
    new Date("2026-10-09T00:00:00Z"),
    () => undefined,
  );
  return root;
}

async function results(root: string, preparationCache: "reuse" | "disabled") {
  const index = await RepositoryKnowledgeQueryIndex.prepare({
    repositoryRoot: root,
    preparationCache,
    ranker: productDefaultRepositoryKnowledgeRanker,
  });
  return ["repositry readiness", "writing policy", "history replica", "qzxvnjkqzvnmqjkx"].map(
    (query) => index.query({ query }),
  );
}

describe("persistent query preparation", () => {
  it("matches cold/full/warm results and observes same-size edits, deletion, and corrupted projections", async () => {
    const root = await repository();
    const full = await results(root, "disabled");
    await expect(access(resolve(root, cacheDirectory))).rejects.toThrow();
    expect(await results(root, "reuse")).toEqual(full);
    const cachePath = resolve(root, cacheDirectory, "source-units.cache");
    const before = await stat(cachePath);
    expect(await results(root, "reuse")).toEqual(full);
    expect((await stat(cachePath)).mtimeMs).toBe(before.mtimeMs);
    expect(full[0]!.hits[0]!.path).toBe("README.md");
    expect(full.at(-1)!.hits).toEqual([]);

    const publication = resolve(root, "policy.md");
    const old = await stat(publication);
    await writeFile(publication, "# Writing policy\nHuman publication changed!.\n");
    await utimes(publication, old.atime, old.mtime);
    expect(await results(root, "reuse")).toEqual(await results(root, "disabled"));
    await rm(publication);
    expect(await results(root, "reuse")).toEqual(await results(root, "disabled"));
    for (const name of ["source-units", "concept-sidecars", "ranker"]) {
      await writeFile(resolve(root, cacheDirectory, `${name}.cache`), "corrupt cache");
      expect(await results(root, "reuse")).toEqual(await results(root, "disabled"));
    }
    await rm(resolve(root, cacheDirectory), { recursive: true });
    expect(await results(root, "reuse")).toEqual(await results(root, "disabled"));
  });

  it("keeps failed preparation and materialization recovery from publishing new projections", async () => {
    const root = await repository();
    await expect(
      RepositoryKnowledgeQueryIndex.prepare({
        repositoryRoot: root,
        ranker: {
          prepare() {
            throw new Error("ranker failure");
          },
        },
      }),
    ).rejects.toThrow("ranker failure");
    await expect(access(resolve(root, cacheDirectory))).rejects.toThrow();
    await results(root, "reuse");
    const cachePath = resolve(root, cacheDirectory, "source-units.cache");
    const previous = await readFile(cachePath);
    const marker = resolve(root, ".lervo/state/knowledge/materialization-transaction");
    await mkdir(marker);
    await writeFile(resolve(marker, "journal.json"), "invalid journal");
    await expect(results(root, "reuse")).rejects.toMatchObject({
      code: "knowledge_recovery_required",
    });
    expect(await readFile(cachePath)).toEqual(previous);
  });
});
