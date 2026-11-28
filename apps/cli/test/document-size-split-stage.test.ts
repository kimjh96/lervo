import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import {
  applyKnowledgeMigrationPlan,
  createDocumentSizeSplitPlan,
  createKnowledgeMigrationPlan,
} from "@lervo/repository-knowledge";
import { afterEach, expect, it } from "vitest";

import {
  DOCUMENT_SIZE_SPLIT_VERIFIER,
  runDocumentSizeSplitStage,
  verifyDocumentSizeSplit,
} from "../src/document-size-split-stage.js";
import { oversizedDocumentsLine } from "../src/normalization-provider-selection.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function io() {
  const out: string[] = [];
  return {
    out,
    io: { cwd: "/", stdout: (text: string) => out.push(text), stderr: () => undefined },
  };
}

it("plans the split of a document too large to normalize, and steps aside when none is", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-size-split-stage-"));
  roots.push(root);
  await mkdir(resolve(root, "docs/specs"), { recursive: true });
  await writeFile(resolve(root, "docs/specs/small.md"), "# Small\n\nKept as it is.\n");
  await applyInitPlan(
    await createInitPlan({ root, projectId: "prj_size_split_stage", now: new Date() }),
  );
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" }),
    new Date(),
    () => undefined,
  );
  const quiet = io();
  expect(
    await runDocumentSizeSplitStage({
      repositoryRoot: root,
      supplementalSources: [],
      json: false,
      io: quiet.io,
    }),
  ).toBeNull();
  expect(quiet.out).toEqual([]);

  const sections = Array.from(
    { length: 700 },
    (_, index) => `## Section ${index}\n\n${"x".repeat(500)}\n`,
  );
  await writeFile(
    resolve(root, "docs/specs/acceptance.md"),
    `# Acceptance\n\n${sections.join("\n")}`,
  );
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" }),
    new Date(),
    () => undefined,
  );
  const planned = io();
  expect(
    await runDocumentSizeSplitStage({
      repositoryRoot: root,
      supplementalSources: [],
      json: false,
      io: planned.io,
    }),
  ).toBe(0);
  const text = planned.out.join("");
  expect(text).toContain("docs/specs/acceptance.md (");
  expect(text).toContain("parts in docs/specs/acceptance");
  const plan = await createDocumentSizeSplitPlan({
    repositoryRoot: root,
    sourcePaths: ["docs/specs/acceptance.md"],
  });
  expect(text).toContain(`Apply with lervo migrate knowledge --apply ${plan.planId}.`);
  expect(await verifyDocumentSizeSplit({ repositoryRoot: root, plan, paths: [] })).toMatchObject({
    verdict: "agree",
    reviewer: DOCUMENT_SIZE_SPLIT_VERIFIER,
  });
  await writeFile(
    resolve(root, "docs/specs/acceptance.md"),
    `# Acceptance\n\nChanged.\n${sections.join("\n")}`,
  );
  expect(await verifyDocumentSizeSplit({ repositoryRoot: root, plan, paths: [] })).toMatchObject({
    verdict: "disagree",
  });
}, 60_000);

it("names documents the split divides apart from those it keeps whole, with their next step", () => {
  expect(oversizedDocumentsLine([])).toBe("");
  const line = oversizedDocumentsLine([
    { path: "docs/big.md", byteCount: 300_000, splittable: true },
    { path: "docs/dump.md", byteCount: 400_000, splittable: false },
  ]);
  expect(line).toContain("split first: docs/big.md (300000 bytes)\n");
  expect(line).toContain("kept whole: docs/dump.md (400000 bytes); split one by its headings");
  expect(line).toContain("normalization.exclude in .lervo/knowledge/policy.yaml");
});
