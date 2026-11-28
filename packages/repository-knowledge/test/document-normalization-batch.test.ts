import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, expect, it } from "vitest";

import {
  createConfiguredDocumentNormalizationPreflight,
  type RepositoryDocumentNormalizationCompiler,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const compiler = {
  descriptor: { compilerId: "test", compilerVersion: "1", provider: "claude", model: null },
  compile: () => Promise.reject(new Error("no provider in this test")),
} as unknown as RepositoryDocumentNormalizationCompiler;

it("normalizes pending documents beyond one run's ceiling a batch per run, in path order", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-normalization-batch-"));
  roots.push(root);
  await mkdir(resolve(root, "docs/operations"), { recursive: true });
  for (const name of ["a", "b", "c", "d"])
    await writeFile(
      resolve(root, `docs/operations/${name}.md`),
      `# ${name}\n\n${"Body text. ".repeat(300)}\n`,
    );
  await applyInitPlan(
    await createInitPlan({ root, projectId: "prj_normalization_batch", now: new Date() }),
  );
  const preflight = await createConfiguredDocumentNormalizationPreflight({
    repositoryRoot: root,
    compiler,
    ceilings: { maximumSourceBytes: 7_000 },
  });
  expect(preflight.status).toBe("ready");
  expect(preflight.blockers).toEqual([]);
  expect(preflight.selection.documents.map((document) => document.path)).toEqual([
    "docs/operations/a.md",
    "docs/operations/b.md",
  ]);
  expect(preflight.workset.selection).toEqual({ kind: "explicit_paths" });
  expect(preflight.workset.repository.pendingDocuments).toBe(4);
  expect(preflight.workset.selectedDocuments).toBe(2);
  // Without a ceiling to exceed, the run records no selection, as before.
  const whole = await createConfiguredDocumentNormalizationPreflight({
    repositoryRoot: root,
    compiler,
  });
  expect(whole.selection.documents).toHaveLength(4);
  expect(whole.workset.selection).toBeUndefined();
});
