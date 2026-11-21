import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, expect, it } from "vitest";

import {
  applyDocumentNormalizationPlan,
  compileConfiguredDocumentNormalizationCandidate,
  createDocumentNormalizationPlan,
  sha256,
  type DocumentNormalizationCandidate,
  type RepositoryDocumentNormalizationCompiler,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const normalizer: RepositoryDocumentNormalizationCompiler = {
  descriptor: {
    compilerId: "lervo.fixture.document-normalizer",
    compilerVersion: "1",
    compilerBuildId: sha256("document-normalizer-fixture"),
    provider: "codex",
    isolation: "external_no_capabilities",
  },
  normalize: async (envelope) => ({
    schemaVersion: 1,
    documents: envelope.documents.map((document) => ({
      sourcePath: document.path,
      outputs: [
        {
          path: document.path,
          content: `# Normalized guide\n\nKeep ${document.path} current.\n`,
          coveredUnitIndexes: document.sourceUnits.map((unit) => unit.index),
        },
      ],
    })),
    telemetry: {
      filesystemReads: 0,
      filesystemWrites: 0,
      shellProcesses: 0,
      networkRequests: 0,
      externalActions: 0,
      toolCalls: 0,
      complete: true,
    },
  }),
};

async function apply(root: string, candidate: DocumentNormalizationCandidate, now: Date) {
  const plan = await createDocumentNormalizationPlan({ repositoryRoot: root, candidate, now });
  await applyDocumentNormalizationPlan({
    plan,
    candidate,
    approvals: plan.items.map(({ operationId, approvalHash }) => ({ operationId, approvalHash })),
    now,
    recordApplied: () => undefined,
  });
}

it("reads a selected source that is no longer pending as stale, not invalid (ADR-0604)", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-normalization-stale-selection-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_document_normalization",
      now: new Date("2026-08-24T00:00:00.000Z"),
    }),
  );
  await mkdir(resolve(root, "docs/operations"), { recursive: true });
  await writeFile(resolve(root, "docs/operations/alpha.md"), "# Alpha\n\nOriginal.\n");
  await writeFile(resolve(root, "docs/operations/beta.md"), "# Beta\n\nOriginal.\n");
  const compile = (sourcePaths?: string[]) =>
    compileConfiguredDocumentNormalizationCandidate({
      repositoryRoot: root,
      compiler: normalizer,
      signal: new AbortController().signal,
      ...(sourcePaths === undefined ? {} : { sourcePaths }),
    });
  const selected = await compile(["docs/operations/beta.md"]);
  // Another writer normalizes every pending document after the selected candidate was generated.
  await apply(root, await compile(), new Date("2026-09-04T00:00:00.000Z"));

  await expect(
    createDocumentNormalizationPlan({
      repositoryRoot: root,
      candidate: selected,
      now: new Date("2026-09-04T01:00:00.000Z"),
    }),
  ).rejects.toMatchObject({ code: "knowledge_plan_stale" });
  // A selection of a path that is not an eligible document at all stays invalid.
  await expect(
    createDocumentNormalizationPlan({
      repositoryRoot: root,
      candidate: {
        ...selected,
        items: selected.items.map((item) => ({ ...item, sourcePath: "docs/operations/gone.md" })),
      },
      now: new Date("2026-09-04T01:00:00.000Z"),
    }),
  ).rejects.toMatchObject({ code: "knowledge_compile_failed" });
});
