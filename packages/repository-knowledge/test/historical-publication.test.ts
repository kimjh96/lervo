import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  applyInitPlan,
  createInitPlan,
  defaultDecisionTaxonomy,
  serializeDecisionTaxonomy,
} from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import { planDecisionTaxonomyRefresh } from "../src/decision-taxonomy-refresh.js";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  queryRepositoryKnowledge,
  type RepositoryKnowledgeQueryRanker,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function put(root: string, path: string, content: string): Promise<void> {
  await mkdir(resolve(root, path, ".."), { recursive: true });
  await writeFile(resolve(root, path), content);
}

/** Models Argo: an archived v1 design and a bannered v1 goal beside the current design. */
async function argoLikeKnowledge(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-historical-"));
  roots.push(root);
  await put(root, "README.md", "# Argo\n\nThe running implementation is v4.\n");
  await put(
    root,
    "docs/archive/v1-final-design.md",
    "# Argo Final Design v1\n\nArgo final design trading model architecture.\n",
  );
  await put(
    root,
    "docs/goals.md",
    "> **Historical (v1, 2026-09-27).** Not the current design.\n\n# Argo v1 goals\n\nArgo final design goals.\n",
  );
  await put(root, "docs/design.md", "# Argo current design\n\nArgo final design for v4 trading.\n");
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_historical" }));
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root }),
    new Date("2026-10-05T00:00:00Z"),
    () => undefined,
  );
  return root;
}

describe("historical document publication and retrieval", () => {
  it("publishes historical documents in a labelled group, not as current documentation", async () => {
    const root = await argoLikeKnowledge();
    const historical = await readFile(resolve(root, "docs/knowledge/historical.md"), "utf8");
    expect(historical).toContain("# Historical documents (not current design)");
    expect(historical).toContain(
      "[Argo Final Design v1](../archive/v1-final-design.md) — `docs/archive/v1-final-design.md` — historical, not current design",
    );
    expect(historical).toContain("`docs/goals.md` — historical, not current design");
    const documentation = await readFile(resolve(root, "docs/knowledge/documentation.md"), "utf8");
    expect(documentation).toContain("docs/design.md");
    expect(documentation).not.toContain("v1-final-design");
    expect(documentation).not.toContain("docs/goals.md");
  });

  it("excludes historical documents from default retrieval unless the query targets history", async () => {
    const root = await argoLikeKnowledge();
    const current = await queryRepositoryKnowledge({
      repositoryRoot: root,
      query: "argo final design",
    });
    expect(current.hits.map((hit) => hit.path)).toContain("docs/design.md");
    expect(current.hits.some((hit) => hit.historical === true)).toBe(false);
    expect(current.hits.map((hit) => hit.path)).not.toContain("docs/archive/v1-final-design.md");

    const history = await queryRepositoryKnowledge({
      repositoryRoot: root,
      query: "archived argo final design",
    });
    expect(
      history.hits.find((hit) => hit.path === "docs/archive/v1-final-design.md"),
    ).toMatchObject({
      historical: true,
    });

    const ranker: RepositoryKnowledgeQueryRanker = {
      prepare(entries) {
        return {
          engine: { id: "fixture", version: 1 },
          adapterBuildId: "fixture",
          rank: () =>
            entries.map((entry, index) => ({
              conceptId: entry.conceptId,
              score: entries.length - index,
            })),
        };
      },
    };
    const ranked = await queryRepositoryKnowledge({
      repositoryRoot: root,
      query: "argo final design",
      limit: 50,
      ranker,
    });
    expect(ranked.hits.map((hit) => hit.path)).not.toContain("docs/archive/v1-final-design.md");
    expect(ranked.hits.map((hit) => hit.path)).not.toContain("docs/goals.md");
  });
});

describe("decision taxonomy refresh", () => {
  const source = serializeDecisionTaxonomy();

  it("prunes unbound Lervo templates through one Lervo-managed update", () => {
    const [operation] = planDecisionTaxonomyRefresh({
      taxonomySource: source,
      taxonomy: defaultDecisionTaxonomy,
      pathExists: (path) => path === "docs/architecture/system.md",
      placedPaths: new Set(),
    });
    expect(operation).toMatchObject({
      path: ".lervo/knowledge/document-layout.yaml",
      action: "update",
      ownership: "lervo_generated",
      reason: "bind_document_role_templates",
    });
    expect(operation?.content).toContain("roleId: system_architecture");
    expect(operation?.content).not.toContain("roleId: product_vision");
    expect(operation?.content).not.toContain("docs/roadmap/index.md");
  });

  it("is current once every template is bound", () => {
    expect(
      planDecisionTaxonomyRefresh({
        taxonomySource: source,
        taxonomy: defaultDecisionTaxonomy,
        pathExists: () => true,
        placedPaths: new Set(),
      }),
    ).toEqual([]);
  });
});
