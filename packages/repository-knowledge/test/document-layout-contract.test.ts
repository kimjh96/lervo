import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan, DecisionTaxonomyContractError } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  lintRepositoryKnowledge,
} from "../src/index.js";

const roots: string[] = [];
const layoutPath = ".lervo/knowledge/document-layout.yaml";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function initializedRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-layout-contract-"));
  roots.push(root);
  await writeFile(resolve(root, "README.md"), "# Layout fixture\n\nStable source.\n");
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_layoutcontract" }));
  return root;
}

async function removeRewriteAndRoutes(root: string): Promise<void> {
  const layout = parse(await readFile(resolve(root, layoutPath), "utf8")) as {
    routes?: unknown;
    documentPolicy: { rewrite?: unknown };
  };
  delete layout.routes;
  delete layout.documentPolicy.rewrite;
  await writeFile(resolve(root, layoutPath), stringify(layout));
}

describe("document layout contract in knowledge plans", () => {
  it("blocks a refresh plan with the same field issues that apply-time lint rejects", async () => {
    const root = await initializedRepository();
    await applyKnowledgeMigrationPlan(
      await createKnowledgeMigrationPlan({ repositoryRoot: root }),
      new Date("2026-10-01T00:00:00Z"),
      () => undefined,
    );
    await removeRewriteAndRoutes(root);

    const refresh = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "refresh" });
    expect(refresh.status).toBe("blocked");
    expect(refresh.blockers).toEqual([
      expect.objectContaining({
        code: "document_layout_contract_invalid",
        path: layoutPath,
        issues: [
          expect.objectContaining({ pointer: "/routes", rule: "required" }),
          expect.objectContaining({ pointer: "/documentPolicy/rewrite", rule: "required" }),
        ],
      }),
    ]);

    const lintFailure = await lintRepositoryKnowledge(root).catch((error: unknown) => error);
    expect(lintFailure).toBeInstanceOf(DecisionTaxonomyContractError);
    expect((lintFailure as DecisionTaxonomyContractError).issues).toEqual(
      refresh.blockers[0]!.issues,
    );
    await expect(
      applyKnowledgeMigrationPlan(refresh, new Date("2026-10-01T00:01:00Z"), () => undefined),
    ).rejects.toMatchObject({ code: "knowledge_reconciliation_conflict" });
  });

  it("reports an unparsable layout as a blocker instead of a ready plan", async () => {
    const root = await initializedRepository();
    await writeFile(resolve(root, layoutPath), "routes: [\n");
    const plan = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "refresh" });
    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toEqual([
      expect.objectContaining({ code: "document_layout_invalid_yaml", issues: [] }),
    ]);
  });
});
