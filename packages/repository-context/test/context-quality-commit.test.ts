import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { createContextQualityCommitQueue } from "../src/context-quality-commit.js";

const roots: string[] = [];
const stores: ProjectStorage[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const storage of stores.splice(0)) await storage.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-quality-commit-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_commitfixture" }));
  const storage = await openProjectStorage(root);
  stores.push(storage);
  return storage;
}
function draft(index: number) {
  return {
    schemaVersion: 1 as const,
    eventId: `evt_commitfixture_${index}`,
    projectId: "prj_commitfixture",
    runId: "run_commitfixture",
    sessionId: "ses_commitfixture",
    type: "run.requested" as const,
    occurredAt: "2026-10-09T00:00:00Z",
    actor: { kind: "user" as const },
    policyVersion: `sha256:${"a".repeat(64)}`,
    payload: { requestDigest: `sha256:${"b".repeat(64)}`, role: "developer" },
  };
}
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
it("checks a ready batch once and returns every receipt only after a durable commit", async () => {
  const storage = await fixture();
  const commit = createContextQualityCommitQueue();
  const current = gate();
  const check = vi.fn(() => current.promise);
  const transaction = vi.spyOn(storage.events, "transact");
  const verify = vi.spyOn(storage.events, "verifyIntegrity");
  let completed = 0;
  const pending = Array.from({ length: 4 }, (_, i) =>
    commit(storage, check, async () => draft(i)).then(() => {
      completed++;
    }),
  );
  await nextTurn();
  await nextTurn();
  expect(check).toHaveBeenCalledTimes(1);
  expect(transaction).not.toHaveBeenCalled();
  expect(completed).toBe(0);
  current.release();
  await Promise.all(pending);
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(verify).toHaveBeenCalledTimes(1);
  expect(storage.events.list()).toHaveLength(4);
  const reopened = await openProjectStorage(storage.paths.repositoryRoot);
  try {
    expect(reopened.events.verifyIntegrity().eventCount).toBe(4);
  } finally {
    await reopened.close();
  }
});
it("does not reuse an in-flight observation for artifacts that become ready later", async () => {
  const storage = await fixture();
  const commit = createContextQualityCommitQueue();
  const current = gate();
  const check = vi.fn(() => current.promise);
  const first = commit(storage, check, async () => draft(0));
  await nextTurn();
  await nextTurn();
  const lateCheck = vi.fn(async () => {
    throw new Error("writer changed");
  });
  const late = commit(storage, lateCheck, async () => draft(1));
  const rejection = expect(late).rejects.toThrow("writer changed");
  current.release();
  await first;
  await rejection;
  expect(check).toHaveBeenCalledTimes(1);
  expect(lateCheck).toHaveBeenCalledTimes(1);
  expect(storage.events.list()).toHaveLength(1);
});
it("rolls back the entire conflicting batch and can retry valid attempts", async () => {
  const storage = await fixture();
  const commit = createContextQualityCommitQueue();
  const check = async () => undefined;
  const changed = { ...draft(0), payload: { ...draft(0).payload, role: "reviewer" } };
  const outcomes = await Promise.allSettled([
    commit(storage, check, async () => draft(0)),
    commit(storage, check, async () => draft(1)),
    commit(storage, check, async () => changed),
  ]);
  expect(outcomes.every((r) => r.status === "rejected")).toBe(true);
  expect(storage.events.list()).toHaveLength(0);
  await commit(storage, check, async () => draft(1));
  expect(storage.events.verifyIntegrity().eventCount).toBe(1);
});
it("deduplicates same-batch retries and isolates completed draft preparation from later mutation", async () => {
  const storage = await fixture();
  const commit = createContextQualityCommitQueue();
  const current = gate();
  const check = () => current.promise;
  const input = draft(0);
  const first = commit(storage, check, async () => input);
  const retry = commit(storage, check, async () => ({
    ...draft(0),
    occurredAt: "2026-10-10T00:00:00Z",
  }));
  await nextTurn();
  await nextTurn();
  input.payload.role = "reviewer";
  current.release();
  await Promise.all([first, retry]);
  expect(storage.events.list()).toHaveLength(1);
  expect(storage.events.list()[0]!.payload.role).toBe("developer");
});
it("bounds all in-flight and queued drafts and releases admission after failure", async () => {
  const storage = await fixture();
  const commit = createContextQualityCommitQueue();
  const current = gate();
  const check = async () => {
    await current.promise;
    throw new Error("stale");
  };
  const pending = Array.from({ length: 16 }, (_, i) =>
    commit(storage, check, async () => draft(i)),
  );
  const outcomes = Promise.allSettled(pending);
  await nextTurn();
  await nextTurn();
  await expect(commit(storage, check, async () => draft(16))).rejects.toThrow("bound");
  current.release();
  expect((await outcomes).every((r) => r.status === "rejected")).toBe(true);
  expect(storage.events.list()).toHaveLength(0);
  await commit(
    storage,
    async () => undefined,
    async () => draft(16),
  );
  expect(storage.events.list()).toHaveLength(1);
});
it("keeps storage identities in separate batches", async () => {
  const a = await fixture(),
    b = await fixture();
  const commit = createContextQualityCommitQueue();
  const checkA = vi.fn(async () => undefined),
    checkB = vi.fn(async () => undefined);
  await Promise.all([
    commit(a, checkA, async () => draft(0)),
    commit(b, checkB, async () => draft(1)),
  ]);
  expect(checkA).toHaveBeenCalledTimes(1);
  expect(checkB).toHaveBeenCalledTimes(1);
  expect(a.events.list()[0]!.eventId).toBe(draft(0).eventId);
  expect(b.events.list()[0]!.eventId).toBe(draft(1).eventId);
});

it("waits for all admitted artifact preparations before observing and committing once", async () => {
  const storage = await fixture();
  const commit = createContextQualityCommitQueue();
  const artifact = gate();
  const check = vi.fn(async () => undefined);
  const transaction = vi.spyOn(storage.events, "transact");
  const pending = [
    commit(storage, check, async () => draft(0)),
    commit(storage, check, async () => {
      await artifact.promise;
      return draft(1);
    }),
  ];
  await nextTurn();
  await nextTurn();
  expect(check).not.toHaveBeenCalled();
  expect(transaction).not.toHaveBeenCalled();
  artifact.release();
  await Promise.all(pending);
  expect(check).toHaveBeenCalledTimes(1);
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(storage.events.verifyIntegrity().eventCount).toBe(2);
});

it("drains an unfinished preparation before rejecting a failed batch and admitting a retry", async () => {
  const storage = await fixture();
  const commit = createContextQualityCommitQueue();
  const artifact = gate();
  const check = vi.fn(async () => undefined);
  let settled = false;
  const pending = Promise.allSettled([
    commit(storage, check, async () => {
      throw new Error("CAS failed");
    }),
    commit(storage, check, async () => {
      await artifact.promise;
      return draft(1);
    }),
  ]).then((result) => {
    settled = true;
    return result;
  });
  await nextTurn();
  await nextTurn();
  expect(settled).toBe(false);
  expect(check).not.toHaveBeenCalled();
  artifact.release();
  expect((await pending).every((r) => r.status === "rejected")).toBe(true);
  expect(check).not.toHaveBeenCalled();
  expect(storage.events.list()).toHaveLength(0);
  await commit(storage, check, async () => draft(2));
  expect(storage.events.verifyIntegrity().eventCount).toBe(1);
});

it("freezes membership while preparation is pending and observes late arrivals separately", async () => {
  const storage = await fixture();
  const commit = createContextQualityCommitQueue();
  const artifact = gate();
  const check = vi.fn(async () => undefined);
  const first = commit(storage, check, async () => draft(0));
  const second = commit(storage, check, async () => {
    await artifact.promise;
    return draft(1);
  });
  await nextTurn();
  await nextTurn();
  const lateCheck = vi.fn(async () => {
    throw new Error("late writer changed");
  });
  const late = commit(storage, lateCheck, async () => draft(2));
  const rejection = expect(late).rejects.toThrow("late writer changed");
  artifact.release();
  await Promise.all([first, second, rejection]);
  expect(check).toHaveBeenCalledTimes(1);
  expect(lateCheck).toHaveBeenCalledTimes(1);
  expect(storage.events.list()).toHaveLength(2);
});

it("rejects excess admission before invoking its preparation effect", async () => {
  const storage = await fixture();
  const commit = createContextQualityCommitQueue();
  const artifact = gate();
  const pending = Array.from({ length: 16 }, (_, i) =>
    commit(
      storage,
      async () => undefined,
      async () => {
        await artifact.promise;
        return draft(i);
      },
    ),
  );
  const excess = vi.fn(async () => draft(16));
  await expect(commit(storage, async () => undefined, excess)).rejects.toThrow("bound");
  expect(excess).not.toHaveBeenCalled();
  artifact.release();
  await Promise.all(pending);
  expect(storage.events.verifyIntegrity().eventCount).toBe(16);
});
