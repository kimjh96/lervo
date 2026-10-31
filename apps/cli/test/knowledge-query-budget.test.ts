import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  defaultRepositoryKnowledgePolicy,
  queryRepositoryKnowledge,
  lintRepositoryKnowledge,
  scanConfiguredRepositoryKnowledge,
} from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import { runKnowledgeQuery } from "../src/knowledge-query-command.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("returns hits and compact JSON and text coverage for a partial scan", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-query-budget-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_querybudget" }));
  await mkdir(resolve(root, "docs/specifications"), { recursive: true });
  await writeFile(resolve(root, "README.md"), "# Repository\nLocal repository knowledge.\n");
  await writeFile(
    resolve(root, "docs/specifications/runtime.md"),
    "# Cobaltmaintenance\nKeep cobaltmaintenance observable.\n",
  );
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root }),
    new Date(),
    () => undefined,
  );
  const complete = await scanConfiguredRepositoryKnowledge(root);
  const budget = complete.scan.inventoryCoverage.includedBytes + 4096;
  await mkdir(resolve(root, "docs/research"), { recursive: true });
  await writeFile(resolve(root, "docs/research/overflow.md"), "r".repeat(budget * 2));
  await writeFile(
    resolve(root, ".lervo/knowledge/policy.yaml"),
    JSON.stringify({
      ...defaultRepositoryKnowledgePolicy,
      limits: { ...defaultRepositoryKnowledgePolicy.limits, maxTotalBytes: budget },
    }),
  );

  const result = await queryRepositoryKnowledge({
    repositoryRoot: root,
    query: "cobaltmaintenance",
  });
  expect(result.coverage).toBe("partial");
  expect(result.skippedForBudget).toEqual({
    count: 1,
    bytes: budget * 2,
    classes: ["other_documents"],
  });
  expect(result.hits.some((hit) => hit.path === "docs/specifications/runtime.md")).toBe(true);
  expect(result.hits.some((hit) => hit.path === "docs/research/overflow.md")).toBe(false);

  for (const json of [true, false]) {
    let output = "";
    let errors = "";
    const code = await runKnowledgeQuery([...(json ? ["--json"] : []), "cobaltmaintenance"], {
      cwd: root,
      stdout: (text) => {
        output += text;
      },
      stderr: (text) => {
        errors += text;
      },
    });
    expect(code, errors).toBe(0);
    expect(errors).toBe("");
    if (json) {
      expect(JSON.parse(output)).toMatchObject({
        coverage: "partial",
        skippedForBudget: result.skippedForBudget,
      });
      expect(JSON.parse(output).hits).not.toHaveLength(0);
    } else {
      expect(output).toContain("Scan coverage: partial;");
      expect(output).toContain("classes: other_documents");
      expect(output).toContain("Cobaltmaintenance");
    }
  }
  const lint = await lintRepositoryKnowledge(root);
  expect(lint).toMatchObject({
    valid: true,
    coverage: "partial",
    skippedForBudget: result.skippedForBudget,
  });
  expect(lint.issues).toContainEqual(
    expect.objectContaining({ code: "knowledge_scan_partial", severity: "warning" }),
  );
  await expect(createKnowledgeMigrationPlan({ repositoryRoot: root })).rejects.toMatchObject({
    code: "knowledge_source_limit_exceeded",
  });
});
