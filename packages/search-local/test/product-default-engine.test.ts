import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  canonicalHash,
  contentId,
  identifySearchQuery,
  SearchEvaluationEngineRegistry,
} from "@lervo/search";
import { afterEach, describe, expect, it } from "vitest";

import { runLocalOperationalSearch } from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("product-default operational search", () => {
  it("uses the shipped qualification without a repository activation transition", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-product-default-engine-"));
    roots.push(root);
    const projectId = "prj_product_default_engine";
    await applyInitPlan(await createInitPlan({ root, projectId }));
    const engine = { id: "lexical", version: 2 } as const;
    const adapterBuildId = contentId("sebuild", { adapter: "product-default-fixture" });
    const registry = new SearchEvaluationEngineRegistry([
      {
        candidateId: "lexical-v2",
        engine: {
          engine,
          adapterBuildId,
          async buildIndex() {
            return {
              engine,
              indexId: contentId("sidx", { engine, corpus: [] }),
              search(query: string, limit: number) {
                return {
                  schemaVersion: 1 as const,
                  engine,
                  indexId: contentId("sidx", { engine, corpus: [] }),
                  ...identifySearchQuery(query),
                  requestedLimit: limit,
                  hits: [],
                  resultSetHash: canonicalHash([]),
                };
              },
            };
          },
        },
      },
    ]);
    const qualificationId = `spqual_${"a".repeat(24)}`;

    await expect(
      runLocalOperationalSearch({
        repositoryRoot: root,
        projectId,
        registry,
        productDefault: {
          qualificationId,
          candidateId: "lexical-v2",
          engine,
          adapterBuildId,
        },
        query: "repository search",
        limit: 5,
      }),
    ).resolves.toMatchObject({
      selection: { mode: "product_default", qualificationId, engine },
      selectionTransitionId: null,
      response: { engine },
      productQualificationId: qualificationId,
    });
  });
});
