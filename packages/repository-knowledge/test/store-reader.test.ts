import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";

import { afterEach, expect, it } from "vitest";
import { stringify } from "yaml";

import { shardedKnowledgeArtifactPath } from "../src/artifact-paths.js";
import { loadStoredConcepts } from "../src/store-reader.js";
import { ConceptSidecarCache } from "../src/concept-sidecar-cache.js";
import {
  legacyStructuralConceptDirectory,
  structuralConceptDirectory,
} from "../src/structural-projection.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("retains every concept, registry order, invalid records, and reviewed duplicate precedence", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-stored-concepts-"));
  roots.push(root);
  const ids = Array.from(
    { length: 37 },
    (_, index) => `concept_${index.toString(16).padStart(24, "0")}`,
  );
  const write = async (directory: string, id: string, title: string, assurance: string) => {
    const path = resolve(root, shardedKnowledgeArtifactPath(directory, id, "yaml"));
    await mkdir(dirname(path), { recursive: true });
    await writeFile(
      path,
      stringify({
        schemaVersion: 1,
        conceptId: id,
        title,
        path: `${id}.md`,
        ownership: "user",
        sourceUnitVersionIds: [],
        assurance,
      }),
    );
  };
  await Promise.all(
    ids.map((id, index) =>
      write(
        structuralConceptDirectory,
        id,
        `current:${index}`,
        index === 1 ? "human_reviewed" : "unreviewed",
      ),
    ),
  );
  await write(legacyStructuralConceptDirectory, ids[0]!, "reviewed legacy", "human_reviewed");
  await write(legacyStructuralConceptDirectory, ids[1]!, "unreviewed legacy", "unreviewed");
  const invalidFile = `${legacyStructuralConceptDirectory}/invalid.yaml`;
  await writeFile(resolve(root, invalidFile), "not: a concept\n");
  const values = await loadStoredConcepts(root);
  expect(
    values.filter((stored) => stored.value !== null).map((stored) => stored.value!.conceptId),
  ).toEqual(ids);
  expect(values[0]!.value!.title).toBe("reviewed legacy");
  expect(values[1]!.value!.title).toBe("current:1");
  expect(values.at(-1)).toMatchObject({ file: invalidFile, value: null });
  expect(values.at(-1)!.error).toContain("contract is invalid");
  const cold = new ConceptSidecarCache();
  expect(await loadStoredConcepts(root, cold)).toEqual(values);
  const warm = new ConceptSidecarCache(cold.snapshot());
  expect(await loadStoredConcepts(root, warm)).toEqual(values);
  expect(warm.statistics).toEqual({ reused: 39, decoded: 0 });
  expect(warm.snapshot()).toBeNull();
  const broken = JSON.parse(JSON.stringify(cold.snapshot()));
  broken.entries[0][1].sourceUnitVersionIds = "corrupt";
  const recovered = new ConceptSidecarCache(broken);
  expect(await loadStoredConcepts(root, recovered)).toEqual(values);
  expect(recovered.statistics).toEqual({ reused: 38, decoded: 1 });
  const incompatible = new ConceptSidecarCache({ ...broken, build: "old-parser" });
  expect(await loadStoredConcepts(root, incompatible)).toEqual(values);
  expect(incompatible.statistics).toEqual({ reused: 0, decoded: 39 });
  await write(structuralConceptDirectory, ids.at(-1)!, "changed", "unreviewed");
  const changed = new ConceptSidecarCache(cold.snapshot());
  expect(await loadStoredConcepts(root, changed)).toEqual(await loadStoredConcepts(root));
  expect(changed.statistics).toEqual({ reused: 38, decoded: 1 });
  await rm(
    resolve(root, shardedKnowledgeArtifactPath(legacyStructuralConceptDirectory, ids[0]!, "yaml")),
  );
  const deleted = new ConceptSidecarCache(changed.snapshot());
  expect(await loadStoredConcepts(root, deleted)).toEqual(await loadStoredConcepts(root));
  expect(deleted.statistics).toEqual({ reused: 38, decoded: 0 });
  expect(deleted.snapshot()).not.toBeNull();
  expect(
    (await loadStoredConcepts(root)).find((stored) => stored.value?.conceptId === ids.at(-1))?.value
      ?.title,
  ).toBe("changed");
});
