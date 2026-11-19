import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { stableId } from "../src/integrity.js";
import { createDocumentMoveLineage, loadDocumentMoveLineages } from "../src/source-lineage.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const projectId = "proj_lineage_bound";
const hash = `sha256:${"a".repeat(64)}`;

describe("document move lineage bound", () => {
  // The lervo repository reached 256 records, the old bound, after five layout migrations; one
  // more move would have failed every scan with knowledge_source_limit_exceeded.
  it("loads more than 256 move records", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-lineage-bound-"));
    roots.push(root);
    const count = 300;
    for (let index = 0; index < count; index += 1) {
      const fromPath = `docs/old/${index}.md`;
      const lineage = createDocumentMoveLineage({
        projectId,
        operationId: stableId("kdocop", { index }),
        fromPath,
        toPath: `docs/new/${index}.md`,
        identityPath: fromPath,
        sourceId: stableId("src", { projectId, path: fromPath }),
        sourceContentHash: hash,
        sourceUnitIds: [`unit_${index}`],
      });
      const path = resolve(root, lineage.file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, lineage.content);
    }
    const loaded = await loadDocumentMoveLineages({ repositoryRoot: root, projectId });
    expect(loaded.records).toHaveLength(count);
    expect(loaded.identityPathByCurrentPath.get("docs/new/299.md")).toBe("docs/old/299.md");
  });
});
