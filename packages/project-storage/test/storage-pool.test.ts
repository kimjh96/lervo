import { mkdtemp, readFile, rename, rm, symlink, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, it, vi } from "vitest";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import * as binding from "../src/storage-pool-binding.js";
import { createProjectStoragePool, openProjectStorage } from "../src/index.js";

const roots: string[] = [];
const pools: ReturnType<typeof createProjectStoragePool>[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const pool of pools.splice(0)) await pool.close().catch(() => undefined);
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-storage-pool-"));
  roots.push(root);
  await applyInitPlan(await createInitPlan({ root, projectId: "prj_poolfixture" }));
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
it("shares only fresh binding observations for an already admitted group", async () => {
  const { root, pool } = await fixture();
  const observations = vi.spyOn(binding, "observeStorageBinding");
  let admitted = 0;
  let release!: () => void;
  const together = new Promise<void>((resolve) => {
    release = resolve;
  });
  await Promise.all(
    Array.from({ length: 4 }, () =>
      pool.run(root, async (_storage, current) => {
        if (++admitted === 4) release();
        await together;
        await current();
      }),
    ),
  );
  // The first admitted group establishes the binding; its commit group observes it again.
  expect(observations).toHaveBeenCalledTimes(2);
});

it("does not defer a lone borrower's current-binding observation to another turn", async () => {
  const { root, pool } = await fixture();
  await pool.run(root, async () => undefined);
  const observations = vi.spyOn(binding, "observeStorageBinding");
  const operation = pool.run(root, async () => undefined);
  await Promise.resolve();
  expect(observations).toHaveBeenCalledTimes(1);
  await operation;
});

it("shares overlapping operations, retains committed records and closes exactly once after idle", async () => {
  const { root, pool, open, closes } = await fixture();
  let active = 0;
  let release!: () => void;
  const together = new Promise<void>((resolve) => {
    release = resolve;
  });
  const uris = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      pool.run(root, async (storage, current) => {
        active++;
        if (active === 4) release();
        await together;
        const artifact = await storage.artifacts.put(`artifact ${index}`);
        await current();
        active--;
        return artifact.uri;
      }),
    ),
  );
  expect(open).toHaveBeenCalledTimes(1);
  expect(new Set(uris).size).toBe(4);
  await delay(100);
  expect(closes).toHaveBeenCalledTimes(1);
  await pool.close();
  expect(closes).toHaveBeenCalledTimes(1);
  await expect(pool.run(root, async () => undefined)).rejects.toMatchObject({
    code: "storage_busy",
  });
});
it("bounds operations per handle and lifetime independently of idle activity", async () => {
  const { root, pool, open, closes } = await fixture();
  const now = vi.spyOn(performance, "now").mockReturnValue(0);
  for (let i = 0; i < 65; i++) await pool.run(root, async () => undefined);
  expect(open).toHaveBeenCalledTimes(2);
  expect(closes).toHaveBeenCalledTimes(1);
  now.mockReturnValue(1001);
  await pool.run(root, async () => undefined);
  expect(open).toHaveBeenCalledTimes(3);
});
it("bounds queued operations and drains accepted work before close", async () => {
  const { root, pool, closes } = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const first = pool.run(root, async () => {
    entered();
    await gate;
  });
  await started;
  const pending = Array.from({ length: 15 }, () => pool.run(root, async () => undefined));
  await expect(pool.run(root, async () => undefined)).rejects.toMatchObject({
    code: "storage_busy",
  });
  const closing = pool.close();
  expect(closes).not.toHaveBeenCalled();
  release();
  await Promise.all([first, ...pending, closing]);
  expect(closes).toHaveBeenCalledTimes(1);
});
it("bounds roots even while their opens have not completed", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pool = createProjectStoragePool(async () => {
    await gate;
    throw new Error("failed open");
  });
  pools.push(pool);
  const pending = Array.from({ length: 8 }, (_, i) =>
    pool.run(`/pool-${i}`, async () => undefined).catch((e: unknown) => e),
  );
  await expect(pool.run("/pool-overflow", async () => undefined)).rejects.toMatchObject({
    code: "storage_busy",
  });
  release();
  await Promise.all(pending);
});
it("closes on operation failure and admits a fresh handle for the next operation", async () => {
  const { root, pool, open, closes } = await fixture();
  await expect(
    pool.run(root, async () => {
      throw new Error("cancelled");
    }),
  ).rejects.toThrow("cancelled");
  expect(closes).toHaveBeenCalledTimes(1);
  await pool.run(root, async () => undefined);
  expect(open).toHaveBeenCalledTimes(2);
});
it.each(["manifest", "database", "cas_symlink"])(
  "rejects replaced %s before using a retained handle",
  async (kind) => {
    const { root, pool, closes } = await fixture();
    await pool.run(root, async () => undefined);
    if (kind === "manifest") {
      const path = resolve(root, ".lervo/project.yaml");
      await writeFile(
        path,
        (await readFile(path, "utf8")).replace("prj_poolfixture", "prj_replacedfixture"),
      );
    } else if (kind === "database") {
      const path = resolve(root, ".lervo/data/events.sqlite");
      await rename(path, `${path}.old`);
      await writeFile(path, await readFile(`${path}.old`));
    } else {
      const path = resolve(root, ".lervo/data/cas");
      await rename(path, `${path}.old`);
      await symlink(`${path}.old`, path);
    }
    const work = vi.fn(async () => undefined);
    await expect(pool.run(root, work)).rejects.toBeDefined();
    expect(work).not.toHaveBeenCalled();
    expect(closes).toHaveBeenCalledTimes(1);
  },
);
it("revalidates identity after an asynchronous effect preparation", async () => {
  const { root, pool } = await fixture();
  await expect(
    pool.run(root, async (_storage, current) => {
      const path = resolve(root, ".lervo/project.yaml");
      await writeFile(
        path,
        (await readFile(path, "utf8")).replace("prj_poolfixture", "prj_replacedfixture"),
      );
      await current();
    }),
  ).rejects.toMatchObject({ code: "storage_binding_changed" });
});
it("retains cleanup failure rather than silently replacing the handle", async () => {
  const { root } = await fixture();
  const open = vi.fn(async (path: string) => {
    const storage = await openProjectStorage(path);
    const close = storage.close.bind(storage);
    storage.close = async () => {
      await close();
      throw new Error("cleanup failure");
    };
    return storage;
  });
  const pool = createProjectStoragePool(open);
  pools.push(pool);
  await expect(
    pool.run(root, async () => {
      throw new Error("operation failure");
    }),
  ).rejects.toMatchObject({ code: "cleanup_failed" });
  await expect(pool.run(root, async () => undefined)).rejects.toMatchObject({
    code: "cleanup_failed",
  });
  expect(open).toHaveBeenCalledTimes(1);
  await expect(pool.close()).rejects.toMatchObject({ code: "cleanup_failed" });
});

it("lets admitted borrowers finish while a use-limit rotation waits for them", async () => {
  const { root, pool, open } = await fixture();
  for (let i = 0; i < 60; i++) await pool.run(root, async () => undefined);
  let release!: () => void;
  let ready!: () => void;
  let count = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const running = Array.from({ length: 4 }, () =>
    pool.run(root, async (_storage, current) => {
      if (++count === 4) ready();
      await gate;
      await current();
    }),
  );
  await started;
  const next = pool.run(root, async () => undefined);
  release();
  await Promise.all([...running, next]);
  expect(open).toHaveBeenCalledTimes(2);
});
it("reclaims pooled WAL frames while preserving full durable event integrity", async () => {
  const { root } = await fixture();
  const pool = createProjectStoragePool();
  pools.push(pool);
  for (let index = 0; index < 3; index++)
    await pool.run(root, async (storage, current) => {
      await current();
      storage.events.transact((transaction) => {
        storage.events.verifyIntegrity();
        transaction.append({
          schemaVersion: 1,
          eventId: `evt_poolfixture_${index}`,
          projectId: "prj_poolfixture",
          runId: "run_poolfixture",
          sessionId: "ses_poolfixture",
          type: "run.requested",
          occurredAt: "2026-10-09T00:00:00Z",
          actor: { kind: "user" },
          policyVersion: `sha256:${"a".repeat(64)}`,
          payload: { requestDigest: `sha256:${"b".repeat(64)}`, role: "developer" },
        });
      });
      expect(storage.events.verifyIntegrity().eventCount).toBe(index + 1);
      expect((await stat(resolve(root, ".lervo/data/events.sqlite-wal"))).size).toBeLessThan(65536);
    });
  await pool.close();
  const storage = await openProjectStorage(root);
  try {
    expect(storage.events.verifyIntegrity().eventCount).toBe(3);
  } finally {
    await storage.close();
  }
});

it("rejects a borrower invalidated while its current-binding observation was in flight", async () => {
  const { root, pool } = await fixture();
  let fail!: () => void;
  let begin!: () => void;
  let release!: () => void;
  const failure = new Promise<void>((resolve) => {
    fail = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    begin = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = binding.observeStorageBinding;
  const first = pool.run(root, async () => {
    begin();
    await failure;
    throw new Error("cancelled");
  });
  const failed = first.catch((error: unknown) => error);
  await entered;
  const second = pool.run(root, async (_storage, current) => {
    vi.spyOn(binding, "observeStorageBinding").mockImplementationOnce(async (storage) => {
      const observed = await original(storage);
      fail();
      await gate;
      return observed;
    });
    await current();
  });
  const rejected = expect(second).rejects.toMatchObject({ code: "storage_binding_changed" });
  await delay(20);
  release();
  await Promise.all([failed, rejected]);
});

it("opens once for overlapping hints and releases its slot before later borrowers", async () => {
  const { root, pool, open, closes } = await fixture();
  const opening = pool.startOpening(root);
  expect(opening).toBeInstanceOf(Promise);
  const sharedOpening = pool.startOpening(root);
  expect(sharedOpening).toBe(opening);
  expect(await sharedOpening).toEqual({ reportWriting: false });
  await opening;
  const observations = vi.spyOn(binding, "observeStorageBinding");
  let entered = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pending = Array.from({ length: 16 }, () =>
    pool.run(root, async () => {
      if (++entered === 16) release();
      await gate;
    }),
  );
  await Promise.all(pending);
  expect(observations).toHaveBeenCalledOnce();
  expect(open).toHaveBeenCalledOnce();
  expect(await pool.startOpening(root)).toEqual({ reportWriting: false });
  expect(observations).toHaveBeenCalledOnce();
  await pool.close();
  expect(closes).toHaveBeenCalledOnce();
  await expect(pool.startOpening(root)).rejects.toMatchObject({ code: "storage_busy" });
});

it("bounds opening hints and drains accepted opens before close even on failure", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const failure = new Error("opening failed");
  const open = vi.fn(async () => {
    await gate;
    throw failure;
  });
  const pool = createProjectStoragePool(open);
  pools.push(pool);
  const pending = Array.from({ length: 8 }, (_, index) =>
    pool.startOpening(`/opening-${index}`)!.catch((error: unknown) => error),
  );
  await expect(pool.startOpening("/opening-overflow")).rejects.toMatchObject({
    code: "storage_busy",
  });
  let closed = false;
  const closing = pool.close().then(() => {
    closed = true;
  });
  await Promise.resolve();
  expect(closed).toBe(false);
  release();
  expect(await Promise.all(pending)).toEqual(Array.from({ length: 8 }, () => failure));
  await closing;
  expect(closed).toBe(true);
  expect(open).toHaveBeenCalledTimes(8);
});

it("checks required writer activation before an opening hint reaches a backend", async () => {
  const { root } = await fixture();
  const open = vi.fn(openProjectStorage);
  const pool = createProjectStoragePool(open, { requiredEventSchemaVersion: 6 });
  pools.push(pool);
  await expect(pool.startOpening(root)).rejects.toMatchObject({
    code: "storage_writer_not_active",
  });
  expect(open).not.toHaveBeenCalled();
  await expect(stat(resolve(root, ".lervo/data/events.sqlite"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
