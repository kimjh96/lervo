import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  defaultRepositoryKnowledgePolicy,
  listKnowledgeArtifactPaths,
  scanRepositoryKnowledge,
} from "../src/index.js";

const roots: string[] = [];

async function temporaryRepository(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-artifact-paths-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("knowledge filesystem metadata", () => {
  it("ignores regular Finder and AppleDouble files in artifact registries", async () => {
    const root = await temporaryRepository();
    const directory = ".lervo/knowledge/concepts";
    const shard = resolve(root, directory, "aa");
    await mkdir(shard, { recursive: true });
    await writeFile(resolve(root, directory, "._aa"), "sidecar");
    await writeFile(resolve(root, directory, ".DS_Store"), "finder");
    await writeFile(resolve(shard, "._concept_aaaaaaaaaaaaaaaaaaaaaaaa.yaml"), "sidecar");
    await writeFile(resolve(shard, "concept_aaaaaaaaaaaaaaaaaaaaaaaa.yaml"), "schemaVersion: 1\n");

    await expect(
      listKnowledgeArtifactPaths({ root, directory, extension: "yaml", maximumFiles: 10 }),
    ).resolves.toEqual([".lervo/knowledge/concepts/aa/concept_aaaaaaaaaaaaaaaaaaaaaaaa.yaml"]);
  });

  it("does not let a metadata-shaped symbolic link bypass registry safety", async () => {
    const root = await temporaryRepository();
    const directory = ".lervo/knowledge/concepts";
    await mkdir(resolve(root, directory), { recursive: true });
    await writeFile(resolve(root, "outside"), "target");
    await symlink(resolve(root, "outside"), resolve(root, directory, "._outside"));

    await expect(
      listKnowledgeArtifactPaths({ root, directory, extension: "yaml", maximumFiles: 10 }),
    ).rejects.toMatchObject({ code: "knowledge_source_unsafe" });
  });

  it("keeps filesystem metadata out of repository source inventories", async () => {
    const root = await temporaryRepository();
    await writeFile(resolve(root, "README.md"), "# Repository\n");
    await writeFile(resolve(root, "._README.md"), "sidecar");
    await writeFile(resolve(root, ".DS_Store"), "finder");

    const scan = await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: "prj_metadatafixture",
      policy: defaultRepositoryKnowledgePolicy,
      observeRevision: async () => ({
        status: "observed",
        content: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n",
      }),
    });

    const paths = scan.sources.map((source) => source.path);
    expect(paths).toContain("README.md");
    expect(paths).not.toContain("._README.md");
    expect(paths).not.toContain(".DS_Store");
  });
});
