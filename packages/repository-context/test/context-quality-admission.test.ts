import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { createQualityRecordingAdmission } from "../src/context-quality-admission.js";
import {
  createQualityRecordingScopes,
  type QualityRecordingScopeAdmission,
} from "../src/context-quality-scope.js";
import type { QualityEventDraft } from "../src/context-quality-event.js";

const roots: string[] = [];
const stores: ProjectStorage[] = [];
afterEach(async () => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  for (const storage of stores.splice(0).reverse()) await storage.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-quality-admission-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_admissionfixture" }));
  const base = await openProjectStorage(root);
  stores.push(base);
  const events = await SQLiteEventStore.open({
    path: base.paths.eventDatabase,
    projectId: base.manifest.projectId,
    writableEventSchemaVersion: 6,
    reportStorage: "sqlite_v1",
  });
  const storage = {
    ...base,
    events,
    writableEventSchemaVersion: 6 as const,
    close: async () => events.close(),
  };
  stores.push(storage);
  return { root, storage };
}
function report(index: number) {
  const bytes = Buffer.from(`complete private report ${index}`);
  const draft: QualityEventDraft = {
    schemaVersion: 6,
    eventId: `evt_admission_${index}`,
    runId: "run_admissionfixture",
    sessionId: "ses_admissionfixture",
    type: "run.requested",
    occurredAt: "2026-10-11T00:00:00Z",
    actor: { kind: "system" },
    policyVersion: `sha256:${"a".repeat(64)}`,
    payload: { requestDigest: `sha256:${"b".repeat(64)}`, role: "developer" },
  };
  return {
    bytes,
    draft,
    contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}
function ready(): QualityRecordingScopeAdmission {
  return { ready: Promise.resolve(), isReady: () => true, admit: vi.fn(), beforeStorage: true };
}

it("owns all sixteen reports before one final fresh borrow and one synchronous publication", async () => {
  const { root, storage } = await fixture();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const scopes = createQualityRecordingScopes();
  for (let i = 0; i < 8; i++) scopes.begin(root, String(i), true);
  const fresh = gate();
  let freshCompleted = false;
  const borrow = vi.fn();
  const admission = createQualityRecordingAdmission(async (_root, work) => {
    borrow();
    await fresh.promise;
    freshCompleted = true;
    return work(storage, async () => {});
  });
  const transaction = storage.events.transact.bind(storage.events);
  const commits = vi.spyOn(storage.events, "transact").mockImplementation((work) => {
    expect(freshCompleted).toBe(true);
    return transaction(work);
  });
  const pending = Array.from({ length: 8 }, (_, i) =>
    admission.admit(root, report(i), scopes.admission(root, String(i), "prepared")!),
  );
  await nextTurn();
  expect(borrow).not.toHaveBeenCalled();
  pending.push(
    ...Array.from({ length: 8 }, (_, i) =>
      admission.admit(root, report(i + 8), scopes.admission(root, String(i), "verified")!),
    ),
  );
  await nextTurn();
  expect(borrow).toHaveBeenCalledOnce();
  expect(commits).not.toHaveBeenCalled();
  fresh.release();
  const receipts = await Promise.all(pending);
  expect(receipts.every((r) => r !== null)).toBe(true);
  expect(commits).toHaveBeenCalledOnce();
  expect(storage.events.verifyIntegrity().eventCount).toBe(16);
  for (let i = 0; i < 16; i++)
    expect(storage.events.reports.getReport(report(i).contentHash)).toEqual(report(i).bytes);
  expect(vi.getTimerCount()).toBe(0);
});

it("snapshots owned bytes and metadata before waiting and preserves exact retry timestamps", async () => {
  const { root, storage } = await fixture();
  const fresh = gate();
  const admission = createQualityRecordingAdmission(async (_root, work) => {
    await fresh.promise;
    return work(storage, async () => {});
  });
  const input = report(0),
    original = Buffer.from(input.bytes);
  const pending = admission.admit(root, input, ready());
  input.bytes.fill(0);
  Object.assign(input.draft.payload, { role: "changed" });
  await nextTurn();
  expect(storage.events.reports.getReport(input.contentHash)).toBeNull();
  fresh.release();
  await pending;
  expect(storage.events.reports.getReport(input.contentHash)).toEqual(original);
  const retry = report(0);
  retry.draft.occurredAt = "2026-10-12T00:00:00Z";
  await admission.admit(root, retry, ready());
  expect(storage.events.verifyIntegrity().eventCount).toBe(1);
  expect(storage.events.get(retry.draft.eventId)?.occurredAt).toBe("2026-10-11T00:00:00Z");
});

it("keeps late membership outside an already started fresh observation", async () => {
  const { root, storage } = await fixture();
  const firstGuard = gate(),
    secondGuard = gate();
  let count = 0;
  const borrow = vi.fn();
  const admission = createQualityRecordingAdmission(async (_root, work) => {
    borrow();
    await (++count === 1 ? firstGuard.promise : secondGuard.promise);
    return work(storage, async () => {});
  });
  const first = admission.admit(root, report(0), ready());
  await nextTurn();
  const second = admission.admit(root, report(1), ready());
  firstGuard.release();
  await first;
  await nextTurn();
  expect(borrow).toHaveBeenCalledTimes(2);
  expect(storage.events.verifyIntegrity().eventCount).toBe(1);
  secondGuard.release();
  await second;
  expect(storage.events.verifyIntegrity().eventCount).toBe(2);
});

it("shares the sixteen-report bound with active legacy calls and normalizes root aliases", async () => {
  const { root, storage } = await fixture();
  const held = gate();
  const admission = createQualityRecordingAdmission(async (_root, work) => {
    await held.promise;
    return work(storage, async () => {});
  });
  const legacy = admission.runLegacy(root, async () => "legacy");
  const pending = Array.from({ length: 15 }, (_, i) => admission.admit(root, report(i), ready()));
  await nextTurn();
  const excess = ready();
  await expect(admission.admit(resolve(root, "child/.."), report(16), excess)).rejects.toThrow(
    "bound",
  );
  await expect(admission.runLegacy(root, async () => "excess")).rejects.toThrow("bound");
  expect(excess.admit).not.toHaveBeenCalled();
  held.release();
  await Promise.all([legacy, ...pending]);
  expect(storage.events.verifyIntegrity().eventCount).toBe(15);
  expect(await admission.runLegacy(root, async () => "recovered")).toBe("recovered");
});

it("bounds roots before borrowing and releases capacity after failed observations", async () => {
  const held = gate();
  const failure = new Error("fresh binding changed");
  const borrow = vi.fn(async () => {
    await held.promise;
    throw failure;
  });
  const admission = createQualityRecordingAdmission(borrow);
  const pending = Array.from({ length: 8 }, (_, i) =>
    admission.admit(`/admission-${i}`, report(i), ready()).catch((e) => e),
  );
  await expect(admission.runLegacy("/admission-overflow", async () => undefined)).rejects.toThrow(
    "bound",
  );
  held.release();
  expect(await Promise.all(pending)).toEqual(Array.from({ length: 8 }, () => failure));
  await expect(admission.admit("/admission-overflow", report(10), ready())).rejects.toBe(failure);
});

it("rejects an entire frozen group after a failed final borrow without writing reports", async () => {
  const { root, storage } = await fixture();
  const failure = new Error("writer changed");
  let fail = true;
  const admission = createQualityRecordingAdmission(async (_root, work) => {
    if (fail) throw failure;
    return work(storage, async () => {});
  });
  const errors = await Promise.all(
    [0, 1].map((i) => admission.admit(root, report(i), ready()).catch((e) => e)),
  );
  expect(errors).toEqual([failure, failure]);
  expect(storage.events.reports.getReport(report(0).contentHash)).toBeNull();
  expect(storage.events.verifyIntegrity().eventCount).toBe(0);
  fail = false;
  await admission.admit(root, report(0), ready());
  expect(storage.events.verifyIntegrity().eventCount).toBe(1);
});

it("rolls back all reports and events on publication mismatch and allows an exact retry", async () => {
  const { root, storage } = await fixture();
  const admission = createQualityRecordingAdmission(async (_root, work) =>
    work(storage, async () => {}),
  );
  const bad = { ...report(1), contentHash: `sha256:${"f".repeat(64)}` };
  const outcomes = await Promise.allSettled([
    admission.admit(root, report(0), ready()),
    admission.admit(root, bad, ready()),
  ]);
  expect(outcomes.every((r) => r.status === "rejected")).toBe(true);
  expect(storage.events.verifyIntegrity().eventCount).toBe(0);
  expect(storage.events.reports.getReport(report(0).contentHash)).toBeNull();
  await admission.admit(root, report(0), ready());
  expect(storage.events.verifyIntegrity().eventCount).toBe(1);
});

it("keeps foreign projects unavailable while valid peers commit and never falls back to CAS", async () => {
  const { root, storage } = await fixture();
  const admission = createQualityRecordingAdmission(async (_root, work) =>
    work(storage, async () => {}),
  );
  const cas = vi.spyOn(storage.artifacts, "put");
  const results = await Promise.all([
    admission.admit(root, { ...report(0), projectId: "prj_foreignproject" }, ready()),
    admission.admit(root, report(1), ready()),
  ]);
  expect(results[0]).toBeNull();
  expect(results[1]?.eventId).toBe(report(1).draft.eventId);
  expect(storage.events.verifyIntegrity().eventCount).toBe(1);
  Object.defineProperty(storage.events, "reportWriter", { value: undefined });
  await expect(admission.admit(root, report(2), ready())).rejects.toThrow("unavailable");
  expect(cas).not.toHaveBeenCalled();
});

it("lets a ready group pass a held scope and drains a missing sibling at the bounded backstop", async () => {
  const { root, storage } = await fixture();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const scopes = createQualityRecordingScopes();
  scopes.begin(root, "held", true);
  const admission = createQualityRecordingAdmission(async (_root, work) =>
    work(storage, async () => {}),
  );
  const held = admission.admit(root, report(0), scopes.admission(root, "held", "prepared")!);
  await nextTurn();
  await admission.admit(root, report(1), ready());
  expect(storage.events.verifyIntegrity().eventCount).toBe(1);
  await vi.advanceTimersByTimeAsync(50);
  await held;
  expect(storage.events.verifyIntegrity().eventCount).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});

it.each(["empty", "oversized", "shared"] as const)(
  "rejects %s bytes before reserving or admitting work",
  async (kind) => {
    const borrow = vi.fn(async () => {
      throw new Error("unexpected borrow");
    });
    const admission = createQualityRecordingAdmission(borrow);
    const bytes =
      kind === "empty"
        ? new Uint8Array(0)
        : kind === "oversized"
          ? new Uint8Array(1_048_577)
          : new Uint8Array(new SharedArrayBuffer(4));
    const scope = ready();
    await expect(admission.admit("/invalid", { ...report(0), bytes }, scope)).rejects.toThrow(
      "byte bound",
    );
    expect(scope.admit).not.toHaveBeenCalled();
    expect(borrow).not.toHaveBeenCalled();
  },
);
