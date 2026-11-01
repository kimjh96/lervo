import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, expect, it } from "vitest";
import { parse, stringify } from "yaml";

import {
  analyzeRepositoryKnowledgeImpact,
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  defaultRepositoryKnowledgePolicy,
  listKnowledgeArtifactPaths,
  queryRepositoryKnowledge,
  scanConfiguredRepositoryKnowledge,
  sha256,
  shardedKnowledgeArtifactPath,
  structuralConceptDirectory,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const tool = "src/zz-tool.ts";

async function repository() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-retention-currency-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_retentioncurrency" }));
  await mkdir(resolve(root, "docs/specifications"), { recursive: true });
  await mkdir(resolve(root, "src"), { recursive: true });
  await writeFile(resolve(root, "README.md"), "# Runtime\n\nLocal execution is supported.\n");
  await writeFile(
    resolve(root, "docs/specifications/runtime.md"),
    "# Cobaltretention\n\nKeep cobaltretention observable.\n",
  );
  await writeFile(
    resolve(root, tool),
    "export function cobaltTool(): number {\n  return 1;\n}\n".padEnd(2048, " "),
  );
  return root;
}

async function setBudget(root: string, maxTotalBytes: number) {
  await writeFile(
    resolve(root, ".lervo/knowledge/policy.yaml"),
    JSON.stringify({
      ...defaultRepositoryKnowledgePolicy,
      limits: { ...defaultRepositoryKnowledgePolicy.limits, maxTotalBytes },
    }),
  );
}

/** A budget that holds every source except the code file, which sorts last in its class. */
async function documentsOnlyBudget(root: string): Promise<number> {
  const { scan } = await scanConfiguredRepositoryKnowledge(root);
  const toolBytes = scan.sources.find((source) => source.path === tool)!.byteCount;
  return scan.inventoryCoverage.includedBytes - toolBytes;
}

async function publicationOutputs(root: string) {
  const plan = await createKnowledgeMigrationPlan({ repositoryRoot: root });
  return plan.operations
    .filter((operation) => operation.path.startsWith("docs/knowledge/"))
    .map(({ path, content, desiredHash }) => ({ path, content, desiredHash }));
}

it("publishes byte-identical structural knowledge with a large and a small budget", async () => {
  const root = await repository();
  const budget = await documentsOnlyBudget(root);
  await setBudget(root, 64 * 1024 * 1024);
  const large = await publicationOutputs(root);
  await setBudget(root, budget);
  const { scan } = await scanConfiguredRepositoryKnowledge(root);
  expect(scan.coverage).toBe("complete");
  expect(scan.sources.find((source) => source.path === tool)?.contentRetention).toBe(
    "observed_only",
  );
  expect(large.length).toBeGreaterThan(0);
  expect(await publicationOutputs(root)).toEqual(large);
});

it("detects edits to observed-only files and leaves their inner units unknown", async () => {
  const root = await repository();
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root }),
    new Date(),
    () => undefined,
  );
  const retained = (await scanConfiguredRepositoryKnowledge(root)).scan;
  const fileUnit = retained.units.find((unit) => unit.path === tool && unit.unitKind === "file")!;
  const symbolUnit = retained.units.find(
    (unit) => unit.path === tool && unit.unitKind === "code_symbol",
  )!;
  expect(symbolUnit).toBeDefined();
  const conceptFiles = await listKnowledgeArtifactPaths({
    root,
    directory: structuralConceptDirectory,
    extension: "yaml",
    maximumFiles: 20_000,
  });
  const concept = (
    await Promise.all(
      conceptFiles.map(
        async (path) =>
          parse(await readFile(resolve(root, path), "utf8")) as { conceptId: string; path: string },
      ),
    )
  ).find((item) => item.path === "README.md")!;
  const claims = {
    claim_aaaaaaaaaaaaaaaaaaaaaaaa: fileUnit,
    claim_bbbbbbbbbbbbbbbbbbbbbbbb: symbolUnit,
  };
  for (const [claimId, unit] of Object.entries(claims)) {
    const statement = `The tool is cited by ${claimId}.`;
    const path = shardedKnowledgeArtifactPath(".lervo/knowledge/claims", claimId, "yaml");
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(
      resolve(root, path),
      stringify(
        {
          schemaVersion: 1,
          claimId,
          conceptId: concept.conceptId,
          statement,
          statementDigest: sha256(statement),
          evidenceUnitVersionIds: [unit.unitVersionId],
          evidenceUnitIds: [unit.unitId],
          assurance: "human_reviewed",
          freshness: "current",
          reviewId: "review_fixture",
        },
        { lineWidth: 0, sortMapEntries: true },
      ),
    );
  }
  const impact = async () => {
    const { scan } = await scanConfiguredRepositoryKnowledge(root);
    expect(scan.coverage).toBe("complete");
    const report = await analyzeRepositoryKnowledgeImpact({ repositoryRoot: root, scan });
    return Object.fromEntries(
      report.items
        .filter((item) => item.subjectKind === "claim")
        .map((item) => [item.subjectId, [item.freshness, item.reasons]]),
    );
  };
  await setBudget(root, await documentsOnlyBudget(root));
  expect(await impact()).toEqual({
    claim_aaaaaaaaaaaaaaaaaaaaaaaa: ["current", []],
    claim_bbbbbbbbbbbbbbbbbbbbbbbb: ["unknown", ["scan_incomplete"]],
  });
  await writeFile(
    resolve(root, tool),
    "export function cobaltTool(): number {\n  return 2;\n}\n".padEnd(2048, " "),
  );
  expect(await impact()).toEqual({
    claim_aaaaaaaaaaaaaaaaaaaaaaaa: ["stale", ["source_unit_changed"]],
    claim_bbbbbbbbbbbbbbbbbbbbbbbb: ["unknown", ["scan_incomplete"]],
  });
});

it("reports observed-only sources with complete query coverage", async () => {
  const root = await repository();
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root }),
    new Date(),
    () => undefined,
  );
  await setBudget(root, await documentsOnlyBudget(root));
  const result = await queryRepositoryKnowledge({
    repositoryRoot: root,
    query: "cobaltretention",
  });
  expect(result.coverage).toBe("complete");
  expect(result.retention.observedOnly).toEqual({
    count: 1,
    bytes: 2048,
    classes: ["source_and_configuration"],
  });
  expect(result.hits.some((hit) => hit.path === "docs/specifications/runtime.md")).toBe(true);
});
