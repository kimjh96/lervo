import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import * as files from "../src/cas-retention-files.js";
import { finishRetention, retentionFixture } from "./cas-retention-fixture.js";

// ADR-0658: a change between the walk and the final inventory comparison makes the pass reread
// only what changed, a bounded number of rounds, instead of giving up.
const fixtures: Awaited<ReturnType<typeof retentionFixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) await f.dispose();
});
async function fixture(label: string) {
  const f = await retentionFixture();
  fixtures.push(f);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-25T00:00:00Z"));
  const { obsolete } = await f.settled(label);
  const directory = resolve(f.storage.paths.knowledgeState, label);
  const state = resolve(directory, "state.json");
  await mkdir(directory, { recursive: true });
  await writeFile(state, "{}");
  return { f, obsolete, state };
}

/** Rewrites `state` right before chosen inventory listings after the first walk. */
function rewriteBeforeListing(state: string, body: (listing: number) => string | null) {
  const list = files.casReferenceFiles;
  let listing = 0;
  vi.spyOn(files, "casReferenceFiles").mockImplementation(async (storage) => {
    listing++;
    const next = listing > 1 ? body(listing) : null;
    if (next !== null) await writeFile(state, next);
    return list(storage);
  });
  return () => listing;
}

it("deletes despite an unrelated file that changed between the walk and the comparison", async () => {
  const { f, obsolete, state } = await fixture("unrelated");
  const listings = rewriteBeforeListing(state, (listing) =>
    listing === 2 ? JSON.stringify({ unrelated: "a longer body" }) : null,
  );
  const result = await finishRetention(f.storage);
  expect(result).toMatchObject({ status: "collected", failure: null, removedObjects: 1 });
  expect(result).not.toHaveProperty("stalledPasses");
  expect(listings()).toBe(3);
  expect(await f.artifacts.has(obsolete.uri)).toBe(false);
});

it("keeps an object that a file starts to name between the walk and the comparison", async () => {
  const { f, obsolete, state } = await fixture("gains");
  rewriteBeforeListing(state, (listing) =>
    listing === 2 ? JSON.stringify({ evidence: obsolete.uri }) : null,
  );
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 0,
  });
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
});

it("counts a stall when the inventory never holds still within the bound", async () => {
  const { f, obsolete, state } = await fixture("restless");
  const listings = rewriteBeforeListing(state, (listing) =>
    JSON.stringify({ write: "x".repeat(listing) }),
  );
  const { compactProjectConvergenceArtifacts } = await import("../src/cas-retention.js");
  expect(await compactProjectConvergenceArtifacts(f.storage)).toMatchObject({
    status: "yielded",
    failure: null,
    removedObjects: 0,
    stalledPasses: 1,
    stallCause: "inventory_changed",
  });
  // The walk, then one listing per round: the first comparison and five rereads.
  expect(listings()).toBe(7);
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
}, 20_000);
