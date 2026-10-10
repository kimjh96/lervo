import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareAppliedInstructionContext } from "../src/applied-instruction-context.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-applied-rules-"));
  roots.push(root);
  await mkdir(resolve(root, "docs/instructions/generated"), { recursive: true });
  return root;
}
function path(index: number) {
  return `docs/instructions/generated/rule_${index.toString(16).padStart(24, "0")}.md`;
}
function prepare(
  root: string,
  expectedPaths: string[] | null = ["src/file.ts"],
  maximumBytes = 16000,
) {
  return prepareAppliedInstructionContext({ repositoryRoot: root, expectedPaths, maximumBytes });
}

describe("applied owner rule preparation", () => {
  it("loads all rules beyond the old sixteen-rule cutoff and keeps exceptions", async () => {
    const root = await fixture();
    for (let i = 0; i < 17; i++)
      await writeFile(
        resolve(root, path(i)),
        `# Rule ${i}\nFull action ${i}.\n## Exceptions\nPreserve examples.`,
      );
    const result = await prepare(root);
    expect(result.report).toMatchObject({
      status: "complete",
      observedCount: 17,
      preparedCount: 17,
    });
    expect(result.context).toContain("Full action 16.");
    expect(result.context).toContain("Preserve examples.");
  });
  it("resolves current targets and preserves unknown scope separately", async () => {
    const root = await fixture();
    await writeFile(
      resolve(root, path(0)),
      '---\npaths: ["src/**"]\n---\n# Scoped\nApply source-only policy.',
    );
    expect((await prepare(root)).report).toMatchObject({ applicableCount: 1, unresolvedCount: 0 });
    expect((await prepare(root, ["docs/guide.md"])).report).toMatchObject({
      excludedCount: 1,
      preparedCount: 0,
    });
    const unknown = await prepare(root, null);
    expect(unknown.report).toMatchObject({
      status: "incomplete",
      unresolvedCount: 1,
      preparedCount: 1,
    });
    expect(unknown.context).toContain('paths: ["src/**"]');
    expect((await prepare(root, [])).report).toEqual(unknown.report);
  });
  it("reports too many rules without returning a partial successful catalog", async () => {
    const root = await fixture();
    for (let i = 0; i < 65; i++) await writeFile(resolve(root, path(i)), "# Rule\nBody.");
    expect(await prepare(root)).toMatchObject({
      context: "",
      report: { status: "unavailable", observedCount: null },
    });
  });
  it("does not turn malformed rules or ancestor symlinks into absent instructions", async () => {
    const root = await fixture();
    await writeFile(resolve(root, path(0)), Buffer.from([0xff]));
    expect((await prepare(root)).report.status).toBe("unavailable");
    const outside = await fixture();
    await rm(resolve(root, "docs"), { recursive: true });
    await symlink(resolve(outside, "docs"), resolve(root, "docs"), "dir");
    expect((await prepare(root)).report.status).toBe("unavailable");
  });
  it("binds every changed source and exposes complete-clause capacity limits", async () => {
    const root = await fixture();
    await writeFile(resolve(root, path(0)), "# Rule\nFirst clause.");
    const before = await prepare(root);
    await writeFile(resolve(root, path(0)), "# Rule\nOther clause.");
    const after = await prepare(root);
    expect(after.report.catalogDigest).not.toBe(before.report.catalogDigest);
    expect((await prepare(root, [], 1)).report).toMatchObject({
      status: "incomplete",
      preparedCount: 0,
      omittedCount: 1,
    });
  });
});

it("preserves exact BOM-prefixed source bytes in the prepared clause", async () => {
  const root = await fixture();
  const source = '\uFEFF---\npaths: ["src/**"]\n---\n# Rule\nBody.';
  await writeFile(resolve(root, path(0)), source);
  expect((await prepare(root)).context).toContain(source);
  expect((await prepare(root, ["docs/guide.md"])).report.preparedCount).toBe(0);
});
