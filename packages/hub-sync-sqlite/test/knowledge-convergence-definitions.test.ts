import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  createKnowledgeConvergenceDefinition,
  MAXIMUM_CONVERGENCE_DEFINITIONS,
  syncContentHash,
} from "@lervo/sync-contract";
import { afterEach, expect, it } from "vitest";

import { HubSyncSQLiteStore } from "../src/index.js";

const coordinate = {
  destinationId: "hub:definitions",
  projectId: "prj_definition_store",
  repositoryIdentityHash: `sha256:${"1".repeat(64)}`,
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function definition(index: number) {
  const suite = { schemaVersion: 1, suiteId: `suite.n${index}`, commands: [] };
  return createKnowledgeConvergenceDefinition({
    projectId: coordinate.projectId,
    repositoryIdentityHash: coordinate.repositoryIdentityHash,
    kind: "verification_suite",
    bindingHash: syncContentHash(suite),
    content: suite,
    publishedAt: "2026-10-06T00:00:00.000Z",
    sourceHostHash: `sha256:${"2".repeat(64)}`,
  })!;
}

it("keeps a bounded, content-addressed set per repository and prunes the least refreshed", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "lervo-hub-definitions-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const store = await HubSyncSQLiteStore.open({ path: resolve(directory, "hub.sqlite") });
  cleanups.push(() => store.close());
  const at = (minute: number) => new Date(Date.UTC(2026, 9, 6, 0, minute)).toISOString();
  for (let index = 0; index < MAXIMUM_CONVERGENCE_DEFINITIONS; index += 1)
    await store.publishKnowledgeConvergenceDefinition({
      destinationId: coordinate.destinationId,
      definition: definition(index),
      acceptedAt: at(index),
    });
  // Definition 0 was published first; refreshing it keeps it when the next one prunes.
  expect(
    await store.publishKnowledgeConvergenceDefinition({
      destinationId: coordinate.destinationId,
      definition: definition(0),
      acceptedAt: at(200),
    }),
  ).toEqual({ status: "refreshed" });
  expect(
    await store.publishKnowledgeConvergenceDefinition({
      destinationId: coordinate.destinationId,
      definition: definition(MAXIMUM_CONVERGENCE_DEFINITIONS),
      acceptedAt: at(201),
    }),
  ).toEqual({ status: "created" });
  const listed = await store.listKnowledgeConvergenceDefinitions(coordinate);
  expect(listed).toHaveLength(MAXIMUM_CONVERGENCE_DEFINITIONS);
  expect(listed[1]).toMatchObject({ contentHash: definition(0).contentHash, publishedAt: at(200) });
  expect(
    await store.readKnowledgeConvergenceDefinition({
      ...coordinate,
      contentHash: definition(1).contentHash,
    }),
  ).toBeNull();
  expect(
    await store.readKnowledgeConvergenceDefinition({
      ...coordinate,
      contentHash: definition(2).contentHash,
    }),
  ).toEqual(definition(2));
});
