import { access, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { createEventReaderCapabilities } from "@lervo/event-contract";
import {
  applyInitPlan,
  createInitPlan,
  planEventWriterActivation,
  applyEventWriterActivationPlan,
  planEventWriterRollback,
} from "@lervo/project";
import { createProjectStoragePool, openProjectStorage } from "../src/index.js";
import * as binding from "../src/storage-pool-binding.js";

const roots: string[] = [];
const pools: ReturnType<typeof createProjectStoragePool>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const pool of pools.splice(0)) await pool.close().catch(() => undefined);
  vi.useRealTimers();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture(targetEventSchemaVersion: 6 | 9 = 6) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-pool-writer-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_poolwriter" }));
  const evidence = {
    schemaVersion: 1,
    projectId: "prj_poolwriter",
    observedAt: new Date().toISOString(),
    readers: [
      {
        readerId: "reader_poolwriter",
        readerKind: "local",
        peerIdentityHash: null,
        capabilities: createEventReaderCapabilities(),
      },
    ],
  };
  const activate = async () => {
    const plan = await planEventWriterActivation({
      repositoryRoot: root,
      evidence,
      targetEventSchemaVersion,
    });
    await applyEventWriterActivationPlan({
      plan,
      approval: plan.planId,
      currentEvidence: evidence,
    });
  };
  const rollback = async () => {
    const plan = await planEventWriterRollback(root);
    await applyEventWriterActivationPlan({ plan, approval: plan.planId });
  };
  const closes = vi.fn();
  const open = vi.fn(async (path: string) => {
    const storage = await openProjectStorage(path);
    const close = storage.close.bind(storage);
    storage.close = async () => {
      closes();
      await close();
    };
    return storage;
  });
  const options: { minimumEventSchemaVersion: 1 | 6 } = { minimumEventSchemaVersion: 6 };
  const pool = createProjectStoragePool(open, options);
  pools.push(pool);
  return { root, pool, open, closes, activate, rollback, options };
}

it("rejects an inactive writer before opening any storage and snapshots its requirement", async () => {
  const { root, pool, open, activate, options } = await fixture();
  options.minimumEventSchemaVersion = 1;
  const work = vi.fn(async () => undefined);
  await expect(pool.run(root, work)).rejects.toMatchObject({ code: "storage_writer_not_active" });
  expect(open).not.toHaveBeenCalled();
  expect(work).not.toHaveBeenCalled();
  await expect(access(resolve(root, ".lervo/data/events.sqlite"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await activate();
  await pool.run(root, async (_storage, current) => current());
  expect(open).toHaveBeenCalledTimes(1);
});

it("admits a writer above the minimum version, since later versions only add event types", async () => {
  const { root, pool, activate } = await fixture(9);
  await activate();
  const work = vi.fn(async (_storage: unknown, current: () => Promise<void>) => current());
  await pool.run(root, work);
  expect(work).toHaveBeenCalledTimes(1);
});

it("observes rollback on a retained handle before work and recovers after reactivation", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { root, pool, open, closes, activate, rollback } = await fixture();
  await activate();
  await pool.run(root, async () => undefined);
  await rollback();
  const work = vi.fn(async () => undefined);
  await expect(pool.run(root, work)).rejects.toMatchObject({ code: "storage_writer_not_active" });
  expect(work).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledTimes(1);
  expect(closes).toHaveBeenCalledTimes(1);
  await activate();
  await pool.run(root, async () => undefined);
  expect(open).toHaveBeenCalledTimes(2);
});

it("keeps a post-admission rollback distinct from an initially inactive writer", async () => {
  const { root, pool, activate, rollback } = await fixture();
  await activate();
  await expect(
    pool.run(root, async (storage, current) => {
      await storage.artifacts.put("prepared before rollback");
      await rollback();
      await current();
    }),
  ).rejects.toMatchObject({ code: "storage_binding_changed" });
});

it("rechecks a writer changed between preflight and opening before allowing work", async () => {
  const { root, pool, open, closes, activate, rollback } = await fixture();
  await activate();
  const original = open.getMockImplementation()!;
  open.mockImplementationOnce(async (path) => {
    await rollback();
    return original(path);
  });
  const work = vi.fn(async () => undefined);
  await expect(pool.run(root, work)).rejects.toMatchObject({ code: "storage_writer_not_active" });
  expect(work).not.toHaveBeenCalled();
  expect(closes).toHaveBeenCalledTimes(1);
});

it("rejects writer drift after opening before establishing the first binding", async () => {
  const { root, pool, open, closes, activate, rollback } = await fixture();
  await activate();
  const original = open.getMockImplementation()!;
  open.mockImplementationOnce(async (path) => {
    const storage = await original(path);
    await rollback();
    return storage;
  });
  const work = vi.fn(async () => undefined);
  await expect(pool.run(root, work)).rejects.toMatchObject({ code: "storage_binding_changed" });
  expect(work).not.toHaveBeenCalled();
  expect(closes).toHaveBeenCalledTimes(1);
});

it.each(["uses", "age", "idle"])(
  "checks inactivity before reopening after %s retirement",
  async (kind) => {
    const { root, pool, open, closes, activate, rollback } = await fixture();
    await activate();
    const now = vi.spyOn(performance, "now").mockReturnValue(0);
    for (let i = 0; i < (kind === "uses" ? 64 : 1); i++)
      await pool.run(root, async () => undefined);
    if (kind === "age") now.mockReturnValue(1001);
    if (kind === "idle") await delay(100);
    await rollback();
    await expect(pool.run(root, async () => undefined)).rejects.toMatchObject({
      code: "storage_writer_not_active",
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(closes).toHaveBeenCalledTimes(1);
  },
);

it("still rejects database replacement through a required-writer retained handle", async () => {
  const { root, pool, activate } = await fixture();
  await activate();
  await pool.run(root, async () => undefined);
  const path = resolve(root, ".lervo/data/events.sqlite");
  await rename(path, `${path}.old`);
  await writeFile(path, await readFile(`${path}.old`));
  const work = vi.fn(async () => undefined);
  await expect(pool.run(root, work)).rejects.toMatchObject({ code: "storage_binding_changed" });
  expect(work).not.toHaveBeenCalled();
});

it("rejects a fresh observation invalidated by another borrower before it completes", async () => {
  const { root, pool, activate } = await fixture();
  await activate();
  let fail!: () => void, entered!: () => void, release!: () => void, observed!: () => void;
  const failure = new Promise<void>((r) => {
    fail = r;
  });
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const observation = new Promise<void>((r) => {
    observed = r;
  });
  const first = pool.run(root, async () => {
    entered();
    await failure;
    throw new Error("cancelled");
  });
  const firstRejected = expect(first).rejects.toThrow("cancelled");
  await started;
  const original = binding.observeStorageBinding;
  vi.spyOn(binding, "observeStorageBinding").mockImplementationOnce(async (...args) => {
    const value = await original(...args);
    fail();
    observed();
    await gate;
    return value;
  });
  const work = vi.fn(async () => undefined);
  const secondRejected = expect(pool.run(root, work)).rejects.toMatchObject({
    code: "storage_binding_changed",
  });
  await observation;
  await new Promise<void>((r) => setImmediate(r));
  release();
  await Promise.all([firstRejected, secondRejected]);
  expect(work).not.toHaveBeenCalled();
});

it("drains admitted work on close and keeps admission failures separate from inactivity", async () => {
  const { root, pool, closes, activate } = await fixture();
  await activate();
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const work = pool.run(root, async (_storage, current) => {
    entered();
    await gate;
    await current();
  });
  await started;
  const pending = Array.from({ length: 15 }, () => pool.run(root, async () => undefined));
  await expect(pool.run(root, async () => undefined)).rejects.toMatchObject({
    code: "storage_busy",
  });
  const closing = pool.close();
  expect(closes).not.toHaveBeenCalled();
  await expect(pool.run(root, async () => undefined)).rejects.toMatchObject({
    code: "storage_busy",
  });
  release();
  await Promise.all([work, ...pending, closing]);
  expect(closes).toHaveBeenCalledTimes(1);
});

it("rejects an unsupported required writer without admitting work", () => {
  expect(() => createProjectStoragePool(undefined, { minimumEventSchemaVersion: 10 as 6 })).toThrow(
    TypeError,
  );
});

it("preserves cleanup failure when discarding an inactive retained writer", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const { root, pool, open, activate, rollback } = await fixture();
  await activate();
  const original = open.getMockImplementation()!;
  open.mockImplementationOnce(async (path) => {
    const storage = await original(path);
    const close = storage.close.bind(storage);
    storage.close = async () => {
      await close();
      throw new Error("cleanup failure");
    };
    return storage;
  });
  await pool.run(root, async () => undefined);
  await rollback();
  const work = vi.fn(async () => undefined);
  await expect(pool.run(root, work)).rejects.toMatchObject({ code: "cleanup_failed" });
  await activate();
  await expect(pool.run(root, work)).rejects.toMatchObject({ code: "cleanup_failed" });
  expect(open).toHaveBeenCalledTimes(1);
  expect(work).not.toHaveBeenCalled();
  await expect(pool.close()).rejects.toMatchObject({ code: "cleanup_failed" });
});
