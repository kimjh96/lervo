import { mkdir, mkdtemp, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { defaultRepositoryKnowledgePolicy } from "../src/policy.js";
import { scanRepositoryKnowledge } from "../src/scanner.js";
import { SourceUnitCache } from "../src/source-unit-cache.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-unit-reuse-"));
  roots.push(root);
  await mkdir(resolve(root, "src"));
  const files = {
    "README.md": "# 문서\n😀 text\n## Details\nmore\n",
    "src/main.ts": "export function answer(): number { return 42; }\n",
    "config.json": '{"enabled":true,"nested":{"한글":1}}\n',
    "config.yaml": "enabled: true\nnested:\n  value: 1\n",
    "style.css": ":root { --color: red; }\n.item { color: var(--color); }\n",
    "trace.log": "# Sensitive heading\nprivate log bytes\n",
    ".env": "secret bytes must never be read\n",
  };
  await Promise.all(
    Object.entries(files).map(([path, content]) => writeFile(resolve(root, path), content)),
  );
  return {
    repositoryRoot: root,
    projectId: "prj_unitcache",
    policy: structuredClone(defaultRepositoryKnowledgePolicy),
    observeRevision: async () => ({
      status: "unavailable" as const,
      reason: "git_head_unavailable" as const,
    }),
  };
}

describe("exact source-unit reuse", () => {
  it("preserves complete cold and warm scans, keeps sensitive sources out, and isolates returned units", async () => {
    const input = await fixture();
    const full = await scanRepositoryKnowledge(input);
    const cold = new SourceUnitCache();
    expect(await scanRepositoryKnowledge({ ...input, sourceUnitCache: cold })).toEqual(full);
    const snapshot = JSON.parse(JSON.stringify(cold.snapshot()));
    cold.release();
    expect(cold.statistics.recomputedSources).toBe(5);
    expect(JSON.stringify(snapshot)).not.toContain("Sensitive heading");
    expect(JSON.stringify(snapshot)).not.toContain("secret bytes");
    const warm = new SourceUnitCache(snapshot);
    const result = await scanRepositoryKnowledge({ ...input, sourceUnitCache: warm });
    expect(result).toEqual(full);
    expect(warm.statistics.recomputedSources).toBe(0);
    expect(warm.statistics.reusedSources).toBe(5);
    expect(warm.snapshot()).toBeNull();
    const relaxed = new SourceUnitCache(snapshot);
    expect(
      await scanRepositoryKnowledge({
        ...input,
        sourceUnitCache: relaxed,
        sourceUnitFailureMode: "file_only",
      }),
    ).toEqual(full);
    expect(relaxed.statistics.recomputedSources).toBe(0);
    result.units[0]!.locator = "mutated result";
    expect(await scanRepositoryKnowledge({ ...input, sourceUnitCache: warm })).toEqual(full);
  });

  it("recomputes exactly one same-size edited source despite restored timestamps", async () => {
    const input = await fixture();
    const cold = new SourceUnitCache();
    await scanRepositoryKnowledge({ ...input, sourceUnitCache: cold });
    const path = resolve(input.repositoryRoot, "src/main.ts");
    const before = await stat(path);
    await writeFile(path, "export function answer(): number { return 43; }\n");
    await utimes(path, before.atime, before.mtime);
    const warm = new SourceUnitCache(cold.snapshot());
    expect(await scanRepositoryKnowledge({ ...input, sourceUnitCache: warm })).toEqual(
      await scanRepositoryKnowledge(input),
    );
    expect(warm.statistics).toMatchObject({ recomputedSources: 1, reusedSources: 4 });
  });

  it("prunes deleted files and correctly handles renames, new files, and changed policy", async () => {
    const input = await fixture();
    const cold = new SourceUnitCache();
    await scanRepositoryKnowledge({ ...input, sourceUnitCache: cold });
    await rm(resolve(input.repositoryRoot, "config.yaml"));
    await rename(
      resolve(input.repositoryRoot, "README.md"),
      resolve(input.repositoryRoot, "renamed.md"),
    );
    await writeFile(resolve(input.repositoryRoot, "new.md"), "# New\n");
    const warm = new SourceUnitCache(cold.snapshot());
    expect(await scanRepositoryKnowledge({ ...input, sourceUnitCache: warm })).toEqual(
      await scanRepositoryKnowledge(input),
    );
    expect(warm.statistics).toMatchObject({ recomputedSources: 2, reusedSources: 3 });
    expect(warm.snapshot()!.entries).toHaveLength(5);
    input.policy.exclude.push("src/**");
    const changedPolicy = new SourceUnitCache(warm.snapshot());
    expect(await scanRepositoryKnowledge({ ...input, sourceUnitCache: changedPolicy })).toEqual(
      await scanRepositoryKnowledge(input),
    );
    expect(changedPolicy.statistics).toMatchObject({ reusedSources: 0, recomputedSources: 4 });
    expect(changedPolicy.snapshot()!.entries).toHaveLength(4);
  });

  it("rejects incompatible or malformed projections and never reuses a file-only failure in strict mode", async () => {
    const input = await fixture();
    const cold = new SourceUnitCache();
    const full = await scanRepositoryKnowledge({ ...input, sourceUnitCache: cold });
    const snapshot = cold.snapshot()!;
    for (const broken of [
      null,
      { ...snapshot, binding: "old-build" },
      { ...snapshot, entries: [...snapshot.entries, snapshot.entries[0]] },
      { ...snapshot, entries: [[snapshot.entries[0]![0], [["invalid"]]]] },
    ]) {
      const cache = new SourceUnitCache(broken);
      expect(await scanRepositoryKnowledge({ ...input, sourceUnitCache: cache })).toEqual(full);
      expect(cache.statistics.reusedSources).toBe(0);
    }
    await writeFile(resolve(input.repositoryRoot, "src/main.ts"), "export function { invalid");
    const relaxed = new SourceUnitCache();
    await scanRepositoryKnowledge({
      ...input,
      sourceUnitCache: relaxed,
      sourceUnitFailureMode: "file_only",
    });
    await expect(
      scanRepositoryKnowledge({
        ...input,
        sourceUnitCache: new SourceUnitCache(relaxed.snapshot()),
      }),
    ).rejects.toMatchObject({ code: "knowledge_unit_extraction_failed" });
  });
});
