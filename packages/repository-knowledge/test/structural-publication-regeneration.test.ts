import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  applyKnowledgeMigrationPlan,
  createKnowledgeMigrationPlan,
  lintRepositoryKnowledge,
} from "../src/index.js";

const roots: string[] = [];
const header = "<!-- lervo:generated repository-knowledge-v1 -->\n";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function materializedRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-publication-regeneration-"));
  roots.push(root);
  await mkdir(resolve(root, "docs/adr"), { recursive: true });
  for (let index = 1; index <= 61; index += 1)
    await writeFile(
      resolve(root, `docs/adr/${String(index).padStart(4, "0")}-decision.md`),
      `# Decision ${index}\n\nBounded decision ${index}.\n`,
    );
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_publicationregen" }));
  await applyKnowledgeMigrationPlan(
    await createKnowledgeMigrationPlan({ repositoryRoot: root }),
    new Date("2026-10-01T00:00:00Z"),
    () => undefined,
  );
  return root;
}

describe("structural publication regeneration", () => {
  it("regenerates an edited page that still carries the generated header", async () => {
    const root = await materializedRepository();
    const page = "docs/knowledge/decisions/page-001.md";
    const generated = await readFile(resolve(root, page), "utf8");
    expect(generated.startsWith(header)).toBe(true);
    await writeFile(resolve(root, page), `${generated}\nA local edit to generated navigation.\n`);

    const refresh = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "refresh" });
    expect(refresh.status).toBe("ready");
    expect(refresh.operations).toContainEqual(
      expect.objectContaining({
        path: page,
        action: "update",
        ownership: "lervo_generated",
        reason: "regenerate_edited_generated_publication",
      }),
    );
    await applyKnowledgeMigrationPlan(refresh, new Date("2026-10-01T00:01:00Z"), () => undefined);
    expect(await readFile(resolve(root, page), "utf8")).toBe(generated);
    expect(
      (await lintRepositoryKnowledge(root)).issues.filter(
        (issue) => issue.code === "generated_output_modified",
      ),
    ).toEqual([]);
  });

  it("keeps a page without the generated header user-owned, even with --rebuild", async () => {
    const root = await materializedRepository();
    const page = "docs/knowledge/decisions/page-001.md";
    const userBytes = "# My decision notes\n\nThese bytes are user-owned now.\n";
    await writeFile(resolve(root, page), userBytes);

    for (const repairMode of ["none", "replace_unrecorded_structural_records"] as const) {
      const refresh = await createKnowledgeMigrationPlan({
        repositoryRoot: root,
        mode: "refresh",
        repairMode,
      });
      expect(refresh.status).toBe("blocked");
      expect(refresh.operations).toContainEqual(
        expect.objectContaining({
          path: page,
          action: "conflict",
          reason: "existing_bytes_are_not_a_recorded_lervo_generation",
        }),
      );
    }
    expect(await readFile(resolve(root, page), "utf8")).toBe(userBytes);
  });

  it("does not regenerate generated-looking files outside the publication root", async () => {
    const root = await materializedRepository();
    await writeFile(resolve(root, "docs/adr/0001-decision.md"), `${header}# Decision 1\n`);
    const refresh = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "refresh" });
    expect(
      refresh.operations.some((operation) => operation.path === "docs/adr/0001-decision.md"),
    ).toBe(false);
    expect(await readFile(resolve(root, "docs/adr/0001-decision.md"), "utf8")).toBe(
      `${header}# Decision 1\n`,
    );
  });
});
