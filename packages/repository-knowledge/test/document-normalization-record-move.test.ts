import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { stringify } from "yaml";

import { shardedKnowledgeArtifactPath } from "../src/artifact-paths.js";
import { normalizationRecordMoveOperations } from "../src/document-normalization-record-move.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture(outputs: Array<{ path: string; contentHash?: string }>) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-normalization-record-move-"));
  roots.push(root);
  const path = shardedKnowledgeArtifactPath(
    ".lervo/knowledge/document-normalizations",
    "knormdoc_aaaaaaaaaaaaaaaaaaaaaaaa",
    "yaml",
  );
  await mkdir(dirname(resolve(root, path)), { recursive: true });
  await writeFile(
    resolve(root, path),
    stringify(
      {
        schemaVersion: 2,
        recordId: "knormdoc_aaaaaaaaaaaaaaaaaaaaaaaa",
        sourcePath: "docs/old.md",
        outputs,
      },
      { sortMapEntries: true },
    ),
  );
  return { root, path };
}

describe("document normalization record move", () => {
  it("relocates one exact normalized document without changing record identity", async () => {
    const { root, path } = await fixture([{ path: "docs/old.md", contentHash: "sha256:old" }]);
    const planned = await normalizationRecordMoveOperations(root, "docs/old.md", "docs/new.md");
    expect(planned.paths).toEqual([path]);
    expect(planned.operations).toHaveLength(1);
    const operation = planned.operations[0]!;
    await writeFile(resolve(root, path), operation.content!);
    const content = await readFile(resolve(root, path), "utf8");
    expect(content).toContain("recordId: knormdoc_aaaaaaaaaaaaaaaaaaaaaaaa");
    expect(content).toContain("sourcePath: docs/new.md");
    expect(content).toContain("path: docs/new.md");
  });

  it("rejects a split normalized family", async () => {
    const { root } = await fixture([{ path: "docs/old.md" }, { path: "docs/old/part.md" }]);
    await expect(
      normalizationRecordMoveOperations(root, "docs/old.md", "docs/new.md"),
    ).rejects.toMatchObject({ code: "knowledge_reconciliation_conflict" });
  });
});
