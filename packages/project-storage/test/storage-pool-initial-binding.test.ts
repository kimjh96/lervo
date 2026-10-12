import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { createProjectStoragePool, openProjectStorage } from "../src/index.js";
import * as binding from "../src/storage-pool-binding.js";

const roots: string[] = [];
const pools: ReturnType<typeof createProjectStoragePool>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const pool of pools.splice(0)) await pool.close().catch(() => undefined);
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
  const root = await mkdtemp(resolve(tmpdir(), "lervo-initial-binding-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_initialbinding" }));
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
  const pool = createProjectStoragePool(open);
  pools.push(pool);
  return { root, pool, open, closes };
}

it("does not let a later observation replace an unfinished initial baseline", async () => {
  const { root, pool, closes } = await fixture();
  const firstObserved = gate(),
    secondObserved = gate(),
    releaseFirst = gate();
  const original = binding.observeStorageBinding;
  let observations = 0;
  vi.spyOn(binding, "observeStorageBinding").mockImplementation(async (...args) => {
    const index = ++observations;
    const value = await original(...args);
    if (index === 1) {
      firstObserved.release();
      await releaseFirst.promise;
    } else if (index === 2) secondObserved.release();
    return value;
  });
  const first = pool.run(root, async (_storage, current) => current());
  const firstResult = expect(first).rejects.toMatchObject({ code: "storage_binding_changed" });
  await firstObserved.promise;
  const path = resolve(root, ".lervo/data/events.sqlite");
  await rename(path, `${path}.old`);
  await writeFile(path, await readFile(`${path}.old`));
  const work = vi.fn(async () => undefined);
  const secondResult = expect(pool.run(root, work)).rejects.toMatchObject({
    code: "storage_binding_changed",
  });
  await secondObserved.promise;
  try {
    expect(work).not.toHaveBeenCalled();
  } finally {
    releaseFirst.release();
  }
  await Promise.all([firstResult, secondResult]);
  expect(work).not.toHaveBeenCalled();
  expect(closes).toHaveBeenCalledTimes(1);
});

it("rejects an initial observer invalidated while waiting for its result", async () => {
  const { root, pool } = await fixture();
  const firstObserved = gate(),
    secondObserved = gate(),
    releaseFirst = gate(),
    releaseSecond = gate();
  const original = binding.observeStorageBinding;
  let observations = 0;
  vi.spyOn(binding, "observeStorageBinding").mockImplementation(async (...args) => {
    const index = ++observations;
    const value = await original(...args);
    if (index === 1) {
      firstObserved.release();
      await releaseFirst.promise;
    } else if (index === 2) {
      secondObserved.release();
      await releaseSecond.promise;
    }
    return value;
  });
  const firstResult = expect(
    pool.run(root, async () => {
      throw new Error("first borrower failed");
    }),
  ).rejects.toThrow("first borrower failed");
  await firstObserved.promise;
  const work = vi.fn(async () => undefined);
  const secondResult = expect(pool.run(root, work)).rejects.toMatchObject({
    code: "storage_binding_changed",
  });
  await secondObserved.promise;
  releaseFirst.release();
  await new Promise<void>((resolve) => setImmediate(resolve));
  releaseSecond.release();
  await Promise.all([firstResult, secondResult]);
  expect(work).not.toHaveBeenCalled();
});

it("drains all first borrowers after a shared initial observation fails", async () => {
  const { root, pool, open, closes } = await fixture();
  const observe = vi
    .spyOn(binding, "observeStorageBinding")
    .mockRejectedValue(new Error("observation failed"));
  const work = vi.fn(async () => undefined);
  const results = await Promise.allSettled(Array.from({ length: 4 }, () => pool.run(root, work)));
  expect(results.every((result) => result.status === "rejected")).toBe(true);
  expect(work).not.toHaveBeenCalled();
  expect(closes).toHaveBeenCalledTimes(1);
  observe.mockRestore();
  await pool.run(root, async (_storage, current) => current());
  expect(open).toHaveBeenCalledTimes(2);
});

it("keeps failed cleanup poisoned when the first observation fails", async () => {
  const { root, pool, open, closes } = await fixture();
  const original = open.getMockImplementation()!;
  open.mockImplementationOnce(async (path) => {
    const storage = await original(path);
    const close = storage.close.bind(storage);
    storage.close = async () => {
      await close();
      throw new Error("close failed");
    };
    return storage;
  });
  vi.spyOn(binding, "observeStorageBinding").mockRejectedValueOnce(new Error("observation failed"));
  const work = vi.fn(async () => undefined);
  await expect(pool.run(root, work)).rejects.toMatchObject({ code: "cleanup_failed" });
  await expect(pool.run(root, work)).rejects.toMatchObject({ code: "cleanup_failed" });
  expect(work).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledTimes(1);
  expect(closes).toHaveBeenCalledTimes(1);
});

it("closes only after an accepted initial observation and its work drain", async () => {
  const { root, pool, closes } = await fixture();
  const observed = gate(),
    release = gate();
  const original = binding.observeStorageBinding;
  vi.spyOn(binding, "observeStorageBinding").mockImplementationOnce(async (...args) => {
    const value = await original(...args);
    observed.release();
    await release.promise;
    return value;
  });
  const operation = pool.run(root, async (_storage, current) => current());
  await observed.promise;
  const closing = pool.close();
  await expect(pool.run(root, async () => undefined)).rejects.toMatchObject({
    code: "storage_busy",
  });
  expect(closes).not.toHaveBeenCalled();
  release.release();
  await Promise.all([operation, closing]);
  expect(closes).toHaveBeenCalledTimes(1);
});
