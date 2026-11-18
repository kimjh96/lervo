import { beforeEach, expect, it, vi } from "vitest";

const sync = vi.hoisted(() => ({
  runWorkstreamReplicationCycle: vi.fn(),
  reconcileDivergentWorkstream: vi.fn(),
}));
vi.mock("@lervo/sync", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lervo/sync")>()),
  ...sync,
}));

import type { NodeRuntimeHealthPublisher } from "../src/health.js";
import { createSyncCycleObserver } from "../src/sync-cycle-observer.js";

const divergent = { status: "divergent", publishedCount: 0, imported: false, headCount: 2 };
const current = { status: "current", publishedCount: 0, imported: false, headCount: 1 };
const reconciled = {
  status: "reconciled",
  kept: "hub",
  workstreamId: "wks_aaaaaaaaaaaaaaaaaaaaaaaa",
  preserved: { workstreamId: "wks_bbbbbbbbbbbbbbbbbbbbbbbb", snapshotContentHash: "sha256:b" },
  notice: { undo: "lervo workstream reconcile --restore sha256:b" },
};

function health() {
  return {
    observeSync: vi.fn(async () => undefined),
    observeWorkstreamReplication: vi.fn(async () => undefined),
    observeWorkstreamReplicationFailure: vi.fn(async () => undefined),
  } as unknown as NodeRuntimeHealthPublisher & {
    observeWorkstreamReplication: ReturnType<typeof vi.fn>;
  };
}

beforeEach(() => {
  sync.runWorkstreamReplicationCycle.mockReset();
  sync.reconcileDivergentWorkstream.mockReset();
});

it("reconciles divergent heads without the owner and reports the replication ready", async () => {
  sync.runWorkstreamReplicationCycle
    .mockResolvedValueOnce(divergent)
    .mockResolvedValueOnce(current);
  sync.reconcileDivergentWorkstream.mockResolvedValueOnce(reconciled);
  const published = health();
  const notices: unknown[] = [];
  await createSyncCycleObserver({
    health: published,
    workstreams: () => ({}) as never,
    onWorkstreamReconciled: (result) => {
      notices.push(result);
    },
  })({ status: "idle" } as never);
  expect(notices).toEqual([reconciled]);
  expect(published.observeWorkstreamReplication).toHaveBeenCalledWith(current);
});

it("keeps reporting divergence while the reconciliation is held as Lervo debt", async () => {
  sync.runWorkstreamReplicationCycle.mockResolvedValueOnce(divergent);
  sync.reconcileDivergentWorkstream.mockResolvedValueOnce({
    status: "held",
    reason: "more_than_two_heads",
    headCount: 3,
  });
  const published = health();
  const held: string[] = [];
  await createSyncCycleObserver({
    health: published,
    workstreams: () => ({}) as never,
    onWorkstreamReconcileHeld: (reasonCode) => {
      held.push(reasonCode);
    },
  })({ status: "idle" } as never);
  expect(held).toEqual(["more_than_two_heads"]);
  expect(sync.runWorkstreamReplicationCycle).toHaveBeenCalledTimes(1);
  expect(published.observeWorkstreamReplication).toHaveBeenCalledWith(divergent);
});

it("reports divergence, not a Hub failure, when a reconciliation attempt fails", async () => {
  sync.runWorkstreamReplicationCycle.mockResolvedValueOnce(divergent);
  sync.reconcileDivergentWorkstream.mockRejectedValueOnce(
    Object.assign(new Error("old Hub"), { code: "hub_unavailable" }),
  );
  const published = health();
  const held: string[] = [];
  await createSyncCycleObserver({
    health: published,
    workstreams: () => ({}) as never,
    onWorkstreamReconcileHeld: (reasonCode) => {
      held.push(reasonCode);
    },
  })({ status: "idle" } as never);
  expect(held).toEqual(["hub_unavailable"]);
  expect(published.observeWorkstreamReplication).toHaveBeenCalledWith(divergent);
});
