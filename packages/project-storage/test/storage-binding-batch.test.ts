import { setImmediate as nextTurn } from "node:timers/promises";
import { expect, it, vi } from "vitest";
import { createStorageBindingBatch } from "../src/storage-binding-batch.js";
import type { ProjectStorage } from "../src/types.js";

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it("observes current bytes only after freezing the admitted callers", async () => {
  const storage = {} as ProjectStorage;
  let binding = "before";
  const observe = vi.fn(async () => binding);
  const current = createStorageBindingBatch(observe);
  const results = Array.from({ length: 4 }, () => current(storage, 6));
  expect(observe).not.toHaveBeenCalled();
  binding = "after";
  expect(await Promise.all(results)).toEqual(Array(4).fill("after"));
  expect(observe).toHaveBeenCalledExactlyOnceWith(storage, 6);
});

it("never admits a later caller to an observation already in flight", async () => {
  const storage = {} as ProjectStorage;
  const first = deferred(),
    second = deferred();
  const observe = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const current = createStorageBindingBatch(observe);
  const before = current(storage, 6);
  await nextTurn();
  expect(observe).toHaveBeenCalledTimes(1);
  const after = current(storage, 6);
  await nextTurn();
  expect(observe).toHaveBeenCalledTimes(2);
  second.resolve("new");
  expect(await after).toBe("new");
  first.resolve("old");
  expect(await before).toBe("old");
});

it("keeps storage handles and required writer versions in separate groups", async () => {
  const storage = {} as ProjectStorage,
    other = {} as ProjectStorage;
  const observe = vi.fn(async (target: ProjectStorage, required?: number) =>
    target === other ? "other" : String(required),
  );
  const current = createStorageBindingBatch(observe);
  expect(await Promise.all([current(storage, 6), current(storage), current(other, 6)])).toEqual([
    "6",
    "undefined",
    "other",
  ]);
  expect(observe).toHaveBeenCalledTimes(3);
});

it("rejects every admitted caller and frees capacity after an observation fails", async () => {
  const storage = {} as ProjectStorage;
  const failure = new Error("changed");
  const observe = vi.fn().mockRejectedValueOnce(failure).mockResolvedValue("fresh");
  const current = createStorageBindingBatch(observe);
  const failed = await Promise.allSettled(Array.from({ length: 16 }, () => current(storage, 6)));
  expect(failed.every((item) => item.status === "rejected" && item.reason === failure)).toBe(true);
  const next = Array.from({ length: 16 }, () => current(storage, 6));
  expect(observe).toHaveBeenCalledTimes(1);
  expect(await Promise.all(next)).toEqual(Array(16).fill("fresh"));
  expect(observe).toHaveBeenCalledTimes(2);
});

it("uses ordinary observation for overflow without retaining an extra caller", async () => {
  const storage = {} as ProjectStorage;
  const first = deferred(),
    overflow = deferred();
  const observe = vi.fn().mockReturnValueOnce(overflow.promise).mockReturnValueOnce(first.promise);
  const current = createStorageBindingBatch(observe);
  const results = Array.from({ length: 17 }, () => current(storage, 6));
  expect(observe).toHaveBeenCalledExactlyOnceWith(storage, 6);
  await nextTurn();
  expect(observe).toHaveBeenCalledTimes(2);
  overflow.resolve("overflow");
  expect(await results[16]).toBe("overflow");
  first.resolve("group");
  expect(await Promise.all(results)).toEqual([...Array<string>(16).fill("group"), "overflow"]);
});
