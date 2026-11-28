import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it } from "vitest";

import { readCasRetentionAttention } from "../src/cas-retention-attention.js";

const NOW = new Date("2026-11-28T12:00:00.000Z");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function observed(observation: Record<string, unknown> | null): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "lervo-cas-attention-"));
  roots.push(root);
  if (observation !== null) {
    await mkdir(join(root, ".lervo/state/knowledge"), { recursive: true });
    await writeFile(
      join(root, ".lervo/state/knowledge/cas-retention-observation.json"),
      JSON.stringify({
        schemaVersion: 1,
        observedAt: "2026-11-28T11:00:00.000Z",
        removedObjects: 0,
        reclaimedBytes: 0,
        ...observation,
      }),
    );
  }
  return root;
}
const attention = async (observation: Record<string, unknown> | null) =>
  readCasRetentionAttention(await observed(observation), NOW);

it("names the path that stops retention and how the owner frees it (ADR-0658)", async () => {
  expect(
    await attention({
      status: "unavailable",
      failure: "unreadable_reference",
      reference: ".lervo/data/repository-coordination-v1",
    }),
  ).toEqual([
    {
      code: "cas_retention_unreadable_reference",
      command: expect.stringContaining(
        'sudo chown -R "$USER" .lervo/data/repository-coordination-v1',
      ),
      detail: ".lervo/data/repository-coordination-v1",
    },
  ]);
});

it("reports an anonymous stop, a full disk and a file that keeps changing", async () => {
  expect(await attention({ status: "unavailable", failure: "failed" })).toEqual([
    { code: "cas_retention_failed", command: expect.stringContaining("lervo doctor") },
  ]);
  expect(await attention({ status: "unavailable", failure: "no_space" })).toMatchObject([
    { code: "cas_retention_no_space" },
  ]);
  expect(
    await attention({ status: "yielded", failure: "unstable_reference", reference: "a.json" }),
  ).toMatchObject([{ code: "cas_retention_unstable_reference", detail: "a.json" }]);
});

it("reports an observation too old to be current, and passes that keep removing nothing", async () => {
  expect(
    await attention({ status: "yielded", failure: null, observedAt: "2026-11-20T00:00:00.000Z" }),
  ).toMatchObject([{ code: "cas_retention_stale", detail: "2026-11-20T00:00:00.000Z" }]);
  expect(
    await attention({
      status: "collected",
      failure: null,
      stalledPasses: 5,
      stallCause: "event_head_changed",
    }),
  ).toMatchObject([
    { code: "cas_retention_stalled", detail: "5 passes removed nothing: event_head_changed" },
  ]);
  expect(
    await attention({
      status: "collected",
      failure: null,
      stalledPasses: 4,
      stallCause: "inventory_changed",
    }),
  ).toEqual([]);
  // ADR-0660: a file that changes faster than a slice reads it is named.
  expect(
    await attention({
      status: "collected",
      failure: null,
      stalledPasses: 5,
      stallCause: "read_budget_exhausted",
      stallReference: ".lervo/state/big.sqlite",
    }),
  ).toMatchObject([
    {
      code: "cas_retention_stalled",
      detail: "5 passes removed nothing: read_budget_exhausted (.lervo/state/big.sqlite)",
    },
  ]);
});

it("stays quiet while retention works", async () => {
  for (const observation of [
    { status: "collected", failure: null },
    { status: "yielded", failure: null },
    null,
  ])
    expect(await attention(observation)).toEqual([]);
});

it("names why retention with work left has run no slice for six hours (ADR-0660)", async () => {
  const waiting = { status: "collected", failure: null, remaining: true };
  // An hour since the last slice is routine.
  expect(await attention(waiting)).toEqual([]);
  const root = await observed({ ...waiting, observedAt: "2026-11-28T05:00:00.000Z" });
  expect(await readCasRetentionAttention(root, NOW)).toMatchObject([
    { code: "cas_retention_waiting", detail: "unknown" },
  ]);
  await writeFile(
    join(root, ".lervo/state/knowledge/cas-retention-wait.json"),
    JSON.stringify({ schemaVersion: 1, cause: "admission_busy", at: NOW.toISOString() }),
  );
  expect(await readCasRetentionAttention(root, NOW)).toMatchObject([
    { code: "cas_retention_waiting", detail: "admission_busy" },
  ]);
  // Without work left, an old observation is only stale once three days pass.
  expect(
    await attention({ ...waiting, remaining: false, observedAt: "2026-11-28T05:00:00.000Z" }),
  ).toEqual([]);
});
