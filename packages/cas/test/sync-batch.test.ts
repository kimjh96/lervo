import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as durability from "@lervo/filesystem-durability";
import { FileSystemCas } from "../src/index.js";

const createBatch = durability.createFileSyncBatch;
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(synchronize: (fds: number[]) => Promise<boolean>) {
  vi.spyOn(durability, "createFileSyncBatch").mockImplementation(() =>
    createBatch({ synchronize }),
  );
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cas-sync-batch-"));
  roots.push(root);
  return { root, cas: await FileSystemCas.open(root) };
}
const uri = (body: string) =>
  `lervo-cas://sha256/${createHash("sha256").update(body).digest("hex")}`;

it("publishes distinct small objects only after their shared synchronization completes", async () => {
  let entered!: () => void, release!: (value: boolean) => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const finish = new Promise<boolean>((r) => {
    release = r;
  });
  const native = vi.fn(async (fds: number[]) => {
    expect(fds).toHaveLength(4);
    entered();
    return finish;
  });
  const { root, cas } = await fixture(native);
  const bodies = ["one", "two", "three", "four"],
    pending = bodies.map((body) => cas.put(body));
  await started;
  expect(await Promise.all(bodies.map((body) => cas.has(uri(body))))).toEqual([
    false,
    false,
    false,
    false,
  ]);
  expect(await readdir(resolve(root, ".tmp"))).toHaveLength(4);
  release(true);
  const receipts = await Promise.all(pending);
  expect(native).toHaveBeenCalledTimes(1);
  for (const [i, receipt] of receipts.entries())
    expect(Buffer.from(await cas.get(receipt.uri)).toString()).toBe(bodies[i]);
  expect(await readdir(resolve(root, ".tmp"))).toEqual([]);
});

it("rejects all group writes after native failure and removes temporary bytes", async () => {
  const failure = new Error("injected native failure");
  const native = vi.fn(async () => {
    throw failure;
  });
  const { root, cas } = await fixture(native);
  const bodies = ["failure-one", "failure-two"],
    results = await Promise.allSettled(bodies.map((body) => cas.put(body)));
  expect(results).toEqual(bodies.map(() => ({ status: "rejected", reason: failure })));
  expect(await readdir(resolve(root, ".tmp"))).toEqual([]);
  expect(await Promise.all(bodies.map((body) => cas.has(uri(body))))).toEqual([false, false]);
});

it("keeps streams and large bodies on the ordinary synchronization path", async () => {
  const native = vi.fn(async () => true),
    { cas } = await fixture(native);
  const streamed = await cas.putStream(
    (async function* () {
      yield "stream";
    })(),
  );
  const large = await cas.put(Buffer.alloc(65537, 42));
  expect(native).not.toHaveBeenCalled();
  expect(Buffer.from(await cas.get(streamed.uri)).toString()).toBe("stream");
  expect(await cas.get(large.uri)).toHaveLength(65537);
});

it("uses per-file sync after ineligible native observation and preserves read-only behavior", async () => {
  const native = vi.fn(async () => false),
    { root, cas } = await fixture(native);
  const receipts = await Promise.all([cas.put("first"), cas.put("second")]);
  expect(receipts.every((r) => r.created)).toBe(true);
  const reader = await FileSystemCas.openReadOnly(root);
  await expect(reader.put("forbidden")).rejects.toMatchObject({ code: "read_only" });
  expect(native).toHaveBeenCalledTimes(1);
  expect(durability.createFileSyncBatch).toHaveBeenCalledTimes(1);
});
