import { existsSync } from "node:fs";
import { readFile, utimes } from "node:fs/promises";

import { afterEach, expect, it, vi } from "vitest";

import { compactProjectConvergenceArtifacts } from "../src/cas-retention.js";
import { recordCasRetentionFailure } from "../src/cas-retention-observation.js";
import { casTombstonePath, expireTombstones } from "../src/cas-retention-tombstones.js";
import { finishRetention, retentionFixture } from "./cas-retention-fixture.js";

// ADR-0658: the head is checked again after the durable tombstone, stalls and failures are
// recorded, and tombstones expire.
const fixtures: Awaited<ReturnType<typeof retentionFixture>>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const f of fixtures.splice(0)) await f.dispose();
});
async function fixture() {
  const f = await retentionFixture();
  fixtures.push(f);
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-10-25T00:00:00Z"));
  return f;
}

it("keeps an object, and withdraws its tombstone, when an event lands after the tombstone", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("late-event");
  const tombstone = casTombstonePath(f.storage.paths.cas, obsolete.contentHash.slice(7));
  const latest = f.storage.events.latest.bind(f.storage.events);
  // An event naming the object is appended once its tombstone is durable: the head moves.
  const moved = vi.spyOn(f.storage.events, "latest").mockImplementation(() => {
    const head = latest();
    return existsSync(tombstone) && head !== null ? { ...head, eventHash: "sha256:moved" } : head;
  });
  expect(await finishRetention(f.storage)).toMatchObject({
    status: "collected",
    removedObjects: 0,
    stalledPasses: 1,
    stallCause: "event_head_changed",
  });
  expect(existsSync(tombstone)).toBe(false);
  expect(await f.artifacts.has(obsolete.uri)).toBe(true);
  expect(await compactProjectConvergenceArtifacts(f.storage)).toMatchObject({ stalledPasses: 2 });
  moved.mockRestore();
  const collected = await finishRetention(f.storage);
  expect(collected).toMatchObject({ status: "collected", removedObjects: 1 });
  expect(collected).not.toHaveProperty("stalledPasses");
  expect(existsSync(tombstone)).toBe(true);
});

it("records a failure the worker caught, such as a full disk", async () => {
  const f = await fixture();
  const full = Object.assign(new Error("no space left on device"), { code: "ENOSPC" });
  await recordCasRetentionFailure(f.storage, full);
  const observation = JSON.parse(
    await readFile(`${f.storage.paths.knowledgeState}/cas-retention-observation.json`, "utf8"),
  ) as Record<string, unknown>;
  expect(observation).toMatchObject({ status: "unavailable", failure: "no_space" });
});

it("expires tombstones past the horizon and keeps newer ones", async () => {
  const f = await fixture();
  const { obsolete } = await f.settled("expiry");
  expect(await finishRetention(f.storage)).toMatchObject({ removedObjects: 1 });
  const tombstone = casTombstonePath(f.storage.paths.cas, obsolete.contentHash.slice(7));
  const now = Date.parse("2027-03-01T00:00:00Z");
  await utimes(tombstone, new Date(now - 30 * 86_400_000), new Date(now - 30 * 86_400_000));
  expect(await expireTombstones(f.storage.paths.cas, now)).toBe(0);
  await utimes(tombstone, new Date(now - 91 * 86_400_000), new Date(now - 91 * 86_400_000));
  expect(await expireTombstones(f.storage.paths.cas, now)).toBe(1);
  expect(existsSync(tombstone)).toBe(false);
  await expect(f.artifacts.get(obsolete.uri)).rejects.toMatchObject({ code: "not_found" });
});
