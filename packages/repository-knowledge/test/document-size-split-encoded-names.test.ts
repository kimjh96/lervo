import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, expect, it } from "vitest";

import { mentionsFileName } from "../src/document-size-split-names.js";
import {
  applyDocumentSizeSplitPlan,
  applyKnowledgeMigrationPlan,
  createDocumentSizeSplitPlan,
  createKnowledgeMigrationPlan,
  inspectConfiguredDocumentNormalization,
} from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-split-encoded-"));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(resolve(root, path, ".."), { recursive: true });
    await writeFile(resolve(root, path), content);
  }
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_size_split",
      now: new Date("2026-11-28T00:00:00Z"),
    }),
  );
  const migration = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  await applyKnowledgeMigrationPlan(migration, new Date("2026-11-28T00:01:00Z"), () => undefined);
  return root;
}

const body = (count: number) =>
  [
    "# Big",
    "",
    "Intro.",
    "",
    ...Array.from({ length: count }, (_, index) => [
      `## S${index}`,
      "",
      "x".repeat(900),
      "",
    ]).flat(),
  ].join("\n");

it("finds a file name spelled plainly or percent-encoded in either hex case", () => {
  expect(mentionsFileName("[s](big doc.md#a)", "big doc.md")).toBe(true);
  expect(mentionsFileName("[s](big%20doc.md#a)", "big doc.md")).toBe(true);
  expect(mentionsFileName("[s](%EC%84%A4%EA%B3%84.md#a)", "설계.md")).toBe(true);
  expect(mentionsFileName("[s](%ec%84%a4%ea%b3%84.md#a)", "설계.md")).toBe(true);
  expect(mentionsFileName("[s](other.md#a)", "big doc.md")).toBe(false);
});

for (const [name, link] of [
  ["big doc.md", "big%20doc.md"],
  ["설계.md", encodeURI("설계.md")],
] as const)
  it(`rewrites a percent-encoded link to ${name} to the part that holds its heading`, async () => {
    const root = await repository({
      [`docs/${name}`]: body(400),
      "docs/linker.md": `# Linker\n\nSee [s](${link}#s300).\n`,
    });
    const normalization = await inspectConfiguredDocumentNormalization({ repositoryRoot: root });
    const sourcePaths = normalization.oversizedDocuments.map((document) => document.path);
    const plan = await createDocumentSizeSplitPlan({ repositoryRoot: root, sourcePaths });
    expect(plan.referenceUpdates.map((update) => update.path)).toEqual(["docs/linker.md"]);
    await applyDocumentSizeSplitPlan({
      plan,
      sourcePaths,
      approvedOperationId: plan.operationId,
      approvedHash: plan.approvalHash,
      now: new Date("2026-11-28T00:02:00Z"),
      recordApplied: () => undefined,
    });
    const linker = await readFile(resolve(root, "docs/linker.md"), "utf8");
    expect(linker).not.toContain(`(${link}#s300)`);
    expect(linker).toMatch(/\]\([^)]*#s300\)/u);
  }, 120_000);
