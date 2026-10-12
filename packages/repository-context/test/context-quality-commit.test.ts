import { createQualityRecordingScopes } from "../src/context-quality-scope.js";
import { createHash } from "node:crypto";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
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
  vi.useRealTimers();
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
  // Appends verify their predecessor; publication no longer rescans the whole history.
  expect(verify).not.toHaveBeenCalled();
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

async function sqlFixture() {
  const storage = await fixture();
  const events = await SQLiteEventStore.open({
    path: storage.paths.eventDatabase,
    projectId: storage.manifest.projectId,
    writableEventSchemaVersion: 6,
    reportStorage: "sqlite_v1",
  });
  const selected = {
    ...storage,
    events,
    close: async () => {
      events.close();
    },
  };
  stores.push(selected);
  return selected;
}
function pendingReport(value = "complete private report") {
  const bytes = Buffer.from(value);
  return { bytes, contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}

it("snapshots SQL report bytes at admission and waits for the final current-binding guard", async () => {
  const storage = await sqlFixture();
  const commit = createContextQualityCommitQueue();
  const current = gate();
  const check = vi.fn(() => current.promise);
  const report = pendingReport();
  const original = Buffer.from(report.bytes);
  const pending = commit(storage, check, async () => draft(0), report);
  report.bytes.fill(0);
  await nextTurn();
  await nextTurn();
  expect(check).toHaveBeenCalledTimes(1);
  expect(storage.events.reports.getReport(report.contentHash)).toBeNull();
  current.release();
  await pending;
  expect(storage.events.reports.getReport(report.contentHash)).toEqual(original);
  expect(storage.events.list()).toHaveLength(1);
});

it("publishes no SQL bytes or event after a rejected final guard or mismatched report hash", async () => {
  const storage = await sqlFixture();
  const commit = createContextQualityCommitQueue();
  const report = pendingReport();
  await expect(
    commit(
      storage,
      async () => {
        throw new Error("binding changed");
      },
      async () => draft(0),
      report,
    ),
  ).rejects.toThrow("binding changed");
  await expect(
    commit(
      storage,
      async () => {},
      async () => draft(0),
      { ...report, contentHash: `sha256:${"0".repeat(64)}` },
    ),
  ).rejects.toThrow("does not match");
  expect(storage.events.reports.getReport(report.contentHash)).toBeNull();
  expect(storage.events.list()).toHaveLength(0);
});

it("drains every admitted SQL preparation after one fails without starting publication", async () => {
  const storage = await sqlFixture();
  const commit = createContextQualityCommitQueue();
  const slow = gate();
  const guard = vi.fn(async () => {});
  const report = pendingReport();
  let settled = false;
  const results = Promise.allSettled([
    commit(
      storage,
      guard,
      async () => {
        throw new Error("preparation failed");
      },
      report,
    ),
    commit(
      storage,
      guard,
      async () => {
        await slow.promise;
        return draft(1);
      },
      report,
    ),
  ]).then((results) => {
    settled = true;
    return results;
  });
  await nextTurn();
  await nextTurn();
  expect(settled).toBe(false);
  expect(guard).not.toHaveBeenCalled();
  slow.release();
  expect((await results).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(storage.events.reports.getReport(report.contentHash)).toBeNull();
  expect(storage.events.list()).toHaveLength(0);
});

it("commits both admitted scope reports together after they arrive on different turns", async () => {
  const storage = await sqlFixture();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const scopes = createQualityRecordingScopes();
  scopes.begin("/scope", "request");
  const commit = createContextQualityCommitQueue();
  const transaction = vi.spyOn(storage.events, "transact");
  const first = commit(
    storage,
    async () => {},
    async () => draft(0),
    pendingReport("first"),
    scopes.admission("/scope", "request", "prepared"),
  );
  await nextTurn();
  await nextTurn();
  expect(transaction).not.toHaveBeenCalled();
  const second = commit(
    storage,
    async () => {},
    async () => draft(1),
    pendingReport("second"),
    scopes.admission("/scope", "request", "verified"),
  );
  await Promise.all([first, second]);
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(storage.events.list()).toHaveLength(2);
  expect(vi.getTimerCount()).toBe(0);
});
it("does not let an unsealed SQL scope hold an unrelated ready report", async () => {
  const storage = await sqlFixture();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const scopes = createQualityRecordingScopes();
  const seal = scopes.begin("/scope", "request")!;
  const commit = createContextQualityCommitQueue();
  let firstSettled = false;
  const first = commit(
    storage,
    async () => {},
    async () => draft(0),
    pendingReport("held"),
    scopes.admission("/scope", "request", "prepared"),
  ).then(() => {
    firstSettled = true;
  });
  await commit(
    storage,
    async () => {},
    async () => draft(1),
    pendingReport("independent"),
  );
  expect(firstSettled).toBe(false);
  expect(storage.events.list()).toHaveLength(1);
  seal();
  await first;
  expect(storage.events.list()).toHaveLength(2);
});
it("drains a failed scoped preparation and its admitted sibling before rejecting both", async () => {
  const storage = await sqlFixture();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const scopes = createQualityRecordingScopes();
  scopes.begin("/scope", "request");
  const commit = createContextQualityCommitQueue(),
    slow = gate();
  let finished = false;
  const first = commit(
    storage,
    async () => {},
    async () => {
      throw new Error("first failed");
    },
    pendingReport("first"),
    scopes.admission("/scope", "request", "prepared"),
  );
  const second = commit(
    storage,
    async () => {},
    async () => {
      await slow.promise;
      return draft(1);
    },
    pendingReport("second"),
    scopes.admission("/scope", "request", "verified"),
  );
  const drained = Promise.allSettled([first, second]).then((results) => {
    finished = true;
    return results;
  });
  await nextTurn();
  expect(finished).toBe(false);
  slow.release();
  expect((await drained).map((result) => result.status)).toEqual(["rejected", "rejected"]);
  expect(storage.events.list()).toHaveLength(0);
  expect(storage.events.reports.getReport(pendingReport("second").contentHash)).toBeNull();
});

it("holds a fixed group of overlapping observations until all eight reports can commit", async () => {
  const storage = await sqlFixture();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const scopes = createQualityRecordingScopes();
  for (let index = 0; index < 4; index++) scopes.begin("/group", String(index));
  const commit = createContextQualityCommitQueue();
  const transaction = vi.spyOn(storage.events, "transact");
  const pending: Promise<void>[] = [];
  let receipts = 0;
  for (let index = 0; index < 4; index++) {
    for (const [offset, kind] of ["prepared", "verified"].entries())
      pending.push(
        commit(
          storage,
          async () => {},
          async () => draft(index * 2 + offset),
          pendingReport(`group-${index}-${kind}`),
          scopes.admission("/group", String(index), kind as "prepared" | "verified"),
        ).then(() => {
          receipts++;
        }),
      );
    await nextTurn();
    if (index < 3) {
      expect(transaction).not.toHaveBeenCalled();
      expect(receipts).toBe(0);
    }
  }
  await Promise.all(pending);
  expect(transaction).toHaveBeenCalledTimes(1);
  expect(receipts).toBe(8);
  expect(storage.events.verifyIntegrity().eventCount).toBe(8);
});
