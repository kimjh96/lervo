import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it } from "vitest";
import { sha256 } from "@lervo/repository-knowledge";
import { prepareCanonicalAssessmentSources } from "../src/canonical-assessment-workset.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function sourceFixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-canonical-workset-"));
  directories.push(root);
  const sources = [];
  for (let i = 0; i < 7; i++) {
    const content = `Exact current source ${i}.\n`;
    const path = `${i}.md`;
    await writeFile(resolve(root, path), content);
    sources.push({ path, contentHash: sha256(content), kind: "text" as const });
  }
  return { root, sources };
}

const ceilings = {
  maximumStages: 8,
  maximumDocuments: 3,
  maximumSourceBytes: 1024,
  maximumProviderCalls: 8,
};

it("honors a reviewed count ceiling while covering the complete source cursor exactly once", async () => {
  const { root, sources } = await sourceFixture();
  const batches = [];
  let offset = 0;
  while (offset < sources.length) {
    const batch = prepareCanonicalAssessmentSources({
      repositoryRoot: root,
      sources,
      offset,
      ceilings,
    });
    batches.push(batch);
    offset += batch.length;
  }
  expect(batches.map((batch) => batch.length)).toEqual([3, 3, 1]);
  expect(batches.flat().map(({ path, contentHash }) => ({ path, contentHash }))).toEqual(
    sources.map(({ path, contentHash }) => ({ path, contentHash })),
  );
  expect(batches.flat().every((source) => sha256(source.content!) === source.contentHash)).toBe(
    true,
  );
});

it("preserves the next source at the byte boundary and refuses an oversized first source", async () => {
  const { root, sources } = await sourceFixture();
  const byteCeilings = { ...ceilings, maximumSourceBytes: 30 };
  const first = prepareCanonicalAssessmentSources({
    repositoryRoot: root,
    sources,
    offset: 0,
    ceilings: byteCeilings,
  });
  expect(first.map((source) => source.path)).toEqual(["0.md"]);
  expect(
    prepareCanonicalAssessmentSources({
      repositoryRoot: root,
      sources,
      offset: first.length,
      ceilings: byteCeilings,
    }).map((source) => source.path),
  ).toEqual(["1.md"]);
  expect(() =>
    prepareCanonicalAssessmentSources({
      repositoryRoot: root,
      sources,
      offset: 0,
      ceilings: { ...ceilings, maximumSourceBytes: 1 },
    }),
  ).toThrow(expect.objectContaining({ code: "knowledge_source_limit_exceeded" }));
  await writeFile(resolve(root, "0.md"), "Changed source bytes.\n");
  expect(() =>
    prepareCanonicalAssessmentSources({ repositoryRoot: root, sources, offset: 0, ceilings }),
  ).toThrow(expect.objectContaining({ code: "source_bytes_changed" }));
});
