import { mkdtemp, mkdir, rm, symlink, utimes, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { sha256 } from "../src/integrity.js";
import { readKnowledgeQueryPublications } from "../src/query-publications.js";
import type { StoredConcept, StoredValue } from "../src/store-reader.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function concept(path: string): StoredValue<StoredConcept> {
  return {
    file: `${path}.yaml`,
    value: {
      schemaVersion: 1,
      conceptId: path,
      title: path,
      path,
      ownership: "user",
      sourceUnitVersionIds: [],
    },
  };
}

describe("fresh query publications", () => {
  it("reads every eligible publication in registry order and preserves unsafe-file filtering", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-query-publications-"));
    roots.push(root);
    const paths = Array.from({ length: 41 }, (_, index) => `doc-${index}.md`);
    await Promise.all(paths.map((path) => writeFile(resolve(root, path), `# ${path}\n한글`)));
    await writeFile(resolve(root, "invalid.md"), Buffer.from([0xff]));
    await writeFile(resolve(root, "oversized.md"), "x".repeat(65));
    await symlink("doc-0.md", resolve(root, "linked.md"));
    await mkdir(resolve(root, "directory.md"));
    const deprecated = concept("doc-0.md");
    deprecated.value!.publicationStatus = "deprecated";
    const result = await readKnowledgeQueryPublications(
      root,
      [
        ...paths.map(concept),
        concept("invalid.md"),
        concept("oversized.md"),
        concept("linked.md"),
        concept("directory.md"),
        concept("missing.md"),
        concept("../outside.md"),
        deprecated,
        { file: "bad.yaml", value: null },
      ],
      64,
    );
    expect(result.map((item) => item.concept.path)).toEqual(paths);
    expect(result.at(-1)).toMatchObject({
      content: "# doc-40.md\n한글",
      contentHash: sha256("# doc-40.md\n한글"),
    });
    expect(await readKnowledgeQueryPublications(root, [concept("doc-0.md")], 1)).toEqual([]);
  });

  it("observes same-size edits with restored timestamps, deletions, and new publications", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-query-freshness-"));
    roots.push(root);
    const path = resolve(root, "current.md");
    await writeFile(path, "old text");
    const before = await stat(path);
    const concepts = [concept("current.md"), concept("new.md")];
    const first = await readKnowledgeQueryPublications(root, concepts, 64);
    await writeFile(path, "new text");
    await utimes(path, before.atime, before.mtime);
    await writeFile(resolve(root, "new.md"), "new publication");
    const second = await readKnowledgeQueryPublications(root, concepts, 64);
    expect(second.map((item) => item.content)).toEqual(["new text", "new publication"]);
    expect(second[0]!.contentHash).not.toBe(first[0]!.contentHash);
    await rm(path);
    expect(
      (await readKnowledgeQueryPublications(root, concepts, 64)).map((item) => item.content),
    ).toEqual(["new publication"]);
  });
});
