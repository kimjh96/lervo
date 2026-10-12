import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { FileSystemCas } from "../src/index.js";
import type { createFileSyncBatch } from "@lervo/filesystem-durability";

function rawWriter(cas: FileSystemCas) {
  return cas as unknown as {
    writeStream(
      chunks: AsyncIterable<string | Uint8Array>,
      synchronize?: ReturnType<typeof createFileSyncBatch>,
    ): ReturnType<FileSystemCas["putStream"]>;
  };
}

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-pending-cas-"));
  roots.push(root);
  return { root, cas: await FileSystemCas.open(root) };
}
function objectPath(root: string, uri: string) {
  const hash = uri.slice("lervo-cas://sha256/".length);
  return resolve(root, "sha256", hash.slice(0, 2), hash.slice(2));
}
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it("shares only an in-flight durable write and preserves raw legacy bytes", async () => {
  const { root, cas } = await fixture();
  const stream = vi.spyOn(rawWriter(cas), "writeStream");
  const receipts = await Promise.all(Array.from({ length: 8 }, () => cas.put("same bytes")));
  expect(stream).toHaveBeenCalledTimes(1);
  expect(receipts.filter((r) => r.created)).toHaveLength(1);
  expect(new Set(receipts.map((r) => r.uri)).size).toBe(1);
  expect(await readFile(objectPath(root, receipts[0]!.uri), "utf8")).toBe("same bytes");
  const reader = await FileSystemCas.openReadOnly(root);
  expect(Buffer.from(await reader.get(receipts[0]!.uri)).toString()).toBe("same bytes");
  await cas.put("same bytes");
  expect(stream).toHaveBeenCalledTimes(2);
});

it("snapshots eligible caller bytes before asynchronous work", async () => {
  const { cas } = await fixture();
  const input = Buffer.from("before");
  const pending = cas.put(input);
  input.fill(120);
  expect(Buffer.from(await cas.get((await pending).uri)).toString()).toBe("before");
});

it("keeps failures shared, retires them, and lets a later attempt write", async () => {
  const { cas } = await fixture();
  const error = new Error("injected write failure");
  const stream = vi.spyOn(rawWriter(cas), "writeStream").mockRejectedValueOnce(error);
  const results = await Promise.allSettled([cas.put("retry"), cas.put("retry")]);
  expect(results).toEqual([
    { status: "rejected", reason: error },
    { status: "rejected", reason: error },
  ]);
  expect(stream).toHaveBeenCalledTimes(1);
  expect((await cas.put("retry")).created).toBe(true);
  expect(stream).toHaveBeenCalledTimes(2);
});

it("freshly rejects corruption after the shared writer finished verification", async () => {
  const { root, cas } = await fixture();
  const original = rawWriter(cas).writeStream.bind(cas);
  vi.spyOn(rawWriter(cas), "writeStream").mockImplementationOnce(async (...args) => {
    const receipt = await original(...args);
    await writeFile(objectPath(root, receipt.uri), "tampered");
    return receipt;
  });
  const [owner, follower] = await Promise.allSettled([cas.put("exact"), cas.put("exact")]);
  expect(owner.status).toBe("fulfilled");
  expect(follower).toMatchObject({ status: "rejected", reason: { code: "corrupt_object" } });
});

it("bounds sharing to sixteen callers without rejecting overflow writes", async () => {
  const { cas } = await fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = rawWriter(cas).writeStream.bind(cas);
  const stream = vi.spyOn(rawWriter(cas), "writeStream").mockImplementation(async (...args) => {
    await gate;
    return original(...args);
  });
  const accepted = Array.from({ length: 16 }, () => cas.put("bounded"));
  const overflow = cas.put("bounded");
  expect(stream).toHaveBeenCalledTimes(2);
  release();
  const receipts = await Promise.all([...accepted, overflow]);
  expect(receipts.filter((r) => r.created)).toHaveLength(1);
  expect(receipts.every((r) => r.uri === receipts[0]!.uri)).toBe(true);
});

it("does not share bodies over 64 KiB or across separate handles", async () => {
  const { root, cas } = await fixture();
  const stream = vi.spyOn(rawWriter(cas), "writeStream");
  await Promise.all([cas.put(Buffer.alloc(65537)), cas.put(Buffer.alloc(65537))]);
  expect(stream).toHaveBeenCalledTimes(2);
  const other = await FileSystemCas.open(root);
  const otherStream = vi.spyOn(rawWriter(other), "writeStream");
  const receipts = await Promise.all([cas.put("separate"), other.put("separate")]);
  expect(stream).toHaveBeenCalledTimes(3);
  expect(otherStream).toHaveBeenCalledTimes(1);
  expect(receipts.filter((r) => r.created)).toHaveLength(1);
});

it("preserves read-only failure for every concurrent caller", async () => {
  const { root } = await fixture();
  const reader = await FileSystemCas.openReadOnly(root);
  const results = await Promise.allSettled([reader.put("x"), reader.put("x")]);
  expect(results).toEqual([
    expect.objectContaining({
      status: "rejected",
      reason: expect.objectContaining({ code: "read_only" }),
    }),
    expect.objectContaining({
      status: "rejected",
      reason: expect.objectContaining({ code: "read_only" }),
    }),
  ]);
});

it("rejects a shared target whose prefix became a directory link", async () => {
  const { root, cas } = await fixture();
  const original = rawWriter(cas).writeStream.bind(cas);
  vi.spyOn(rawWriter(cas), "writeStream").mockImplementationOnce(async (...args) => {
    const receipt = await original(...args);
    const hash = receipt.contentHash.slice(7);
    const prefix = resolve(root, "sha256", hash.slice(0, 2));
    const moved = resolve(root, "moved-prefix");
    await rename(prefix, moved);
    await symlink(moved, prefix, "junction");
    return receipt;
  });
  const results = await Promise.allSettled([cas.put("prefix"), cas.put("prefix")]);
  expect(results[1]).toMatchObject({ status: "rejected", reason: { code: "unsafe_path" } });
});
