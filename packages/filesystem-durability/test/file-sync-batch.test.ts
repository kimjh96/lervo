import { expect, it, vi } from "vitest";
import { createFileSyncBatch } from "../src/file-sync-batch.js";

const handle = (fd: number) => ({ fd, sync: vi.fn(async (): Promise<void> => undefined) });
function gate<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
const tick = async () => {
  await turn();
  await turn();
};

it("freezes admitted membership, drains preparations and waits for native completion", async () => {
  const ready = gate<ReturnType<typeof handle>>(),
    finish = gate<boolean>();
  const native = { synchronize: vi.fn(() => finish.promise) };
  const sync = createFileSyncBatch(native),
    a = handle(1),
    b = handle(2);
  let settled = false;
  const first = sync(async () => a).then((value) => {
    settled = true;
    return value;
  });
  const second = sync(() => ready.promise);
  await tick();
  expect(native.synchronize).not.toHaveBeenCalled();
  ready.resolve(b);
  await tick();
  expect(native.synchronize).toHaveBeenCalledExactlyOnceWith([1, 2]);
  expect(settled).toBe(false);
  finish.resolve(true);
  expect(await first).toBe(a);
  expect(await second).toBe(b);
  expect(a.sync).not.toHaveBeenCalled();
  expect(b.sync).not.toHaveBeenCalled();
});

it("drains peer preparation failures before rejecting without invoking native sync", async () => {
  const ready = gate<ReturnType<typeof handle>>();
  const native = { synchronize: vi.fn(async () => true) },
    sync = createFileSyncBatch(native);
  let settled = false;
  const first = sync(async () => {
    throw new Error("open failed");
  }).catch((error) => {
    settled = true;
    return error;
  });
  const second = sync(() => ready.promise).catch((error) => error);
  await tick();
  expect(settled).toBe(false);
  ready.resolve(handle(2));
  const [a, b] = await Promise.all([first, second]);
  expect(a).toBeInstanceOf(AggregateError);
  expect(a).toBe(b);
  expect(native.synchronize).not.toHaveBeenCalled();
  await sync(async () => handle(3));
  expect(native.synchronize).toHaveBeenCalledExactlyOnceWith([3]);
});

it("uses ordinary sync only when native eligibility is rejected", async () => {
  const native = { synchronize: vi.fn(async () => false) },
    sync = createFileSyncBatch(native);
  const a = handle(1),
    b = handle(2);
  await Promise.all([sync(async () => a), sync(async () => b)]);
  expect(a.sync).toHaveBeenCalledTimes(1);
  expect(b.sync).toHaveBeenCalledTimes(1);
});

it("drains fallback peers even when a sync throws synchronously", async () => {
  const done = gate<void>(),
    a = handle(1),
    b = handle(2);
  a.sync.mockImplementation(() => {
    throw new Error("sync failed");
  });
  b.sync.mockImplementation(() => done.promise);
  const sync = createFileSyncBatch({ synchronize: async () => false });
  let settled = false;
  const calls = [sync(async () => a), sync(async () => b)].map((p) =>
    p.catch((error) => {
      settled = true;
      return error;
    }),
  );
  await tick();
  expect(b.sync).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  done.resolve();
  const errors = await Promise.all(calls);
  expect(errors[0]).toBeInstanceOf(AggregateError);
  expect(errors[0]).toBe(errors[1]);
});

it("propagates native failure without downgrading and releases admission", async () => {
  const failure = new Error("native failed");
  const native = { synchronize: vi.fn(async () => true).mockRejectedValueOnce(failure) };
  const sync = createFileSyncBatch(native),
    a = handle(1),
    b = handle(2);
  const results = await Promise.allSettled([sync(async () => a), sync(async () => b)]);
  expect(results).toEqual([
    { status: "rejected", reason: failure },
    { status: "rejected", reason: failure },
  ]);
  expect(a.sync).not.toHaveBeenCalled();
  expect(b.sync).not.toHaveBeenCalled();
  await expect(sync(async () => handle(3))).resolves.toMatchObject({ fd: 3 });
});

it("keeps late arrivals in a separate fixed group", async () => {
  const finish = gate<boolean>(),
    native = { synchronize: vi.fn(() => finish.promise) };
  const sync = createFileSyncBatch(native);
  const first = sync(async () => handle(1));
  await tick();
  const second = sync(async () => handle(2));
  await tick();
  expect(native.synchronize.mock.calls).toEqual([[[1]], [[2]]]);
  finish.resolve(true);
  await Promise.all([first, second]);
});

it("bounds queued and active members together and syncs overflow independently", async () => {
  const finish = gate<boolean>(),
    native = { synchronize: vi.fn(() => finish.promise) };
  const sync = createFileSyncBatch(native),
    handles = Array.from({ length: 17 }, (_, i) => handle(i));
  const accepted = handles.slice(0, 16).map((h) => sync(async () => h));
  await tick();
  await sync(async () => handles[16]!);
  expect(native.synchronize).toHaveBeenCalledExactlyOnceWith(
    Array.from({ length: 16 }, (_, i) => i),
  );
  expect(handles[16]!.sync).toHaveBeenCalledTimes(1);
  finish.resolve(true);
  await Promise.all(accepted);
});

it("does not share admission or failures between store queues", async () => {
  const a = createFileSyncBatch({
    synchronize: async () => {
      throw new Error("first store");
    },
  });
  const b = createFileSyncBatch({ synchronize: async () => true });
  const results = await Promise.allSettled([a(async () => handle(1)), b(async () => handle(2))]);
  expect(results[0]!.status).toBe("rejected");
  expect(results[1]!.status).toBe("fulfilled");
});

it("rejects a malformed native result without a success receipt or fallback", async () => {
  const h = handle(1),
    sync = createFileSyncBatch({ synchronize: async () => undefined as unknown as boolean });
  await expect(sync(async () => h)).rejects.toThrow("Invalid native synchronization result");
  expect(h.sync).not.toHaveBeenCalled();
});
