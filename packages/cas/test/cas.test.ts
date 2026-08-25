import { mkdtemp, readFile, readdir, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CasError, FileSystemCas, OwnerOnlyFileSystemCas } from "../src/index.js";

const temporaryRoots: string[] = [];

async function casRoot(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cas-"));
  temporaryRoots.push(root);
  return resolve(root, "state/cas");
}

function pathForUri(root: string, uri: string): string {
  const hash = uri.slice("lervo-cas://sha256/".length);
  return resolve(root, "sha256", hash.slice(0, 2), hash.slice(2));
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("file system content-addressed storage", () => {
  it("stores content by SHA-256 and deduplicates identical bytes", async () => {
    const root = await casRoot();
    const cas = await FileSystemCas.open(root);

    const first = await cas.put("identical source text");
    const second = await cas.put(Buffer.from("identical source text", "utf8"));

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second).toMatchObject({
      uri: first.uri,
      contentHash: first.contentHash,
      byteCount: first.byteCount,
    });
    expect(Buffer.from(await cas.get(first.uri)).toString("utf8")).toBe("identical source text");
    expect(await readFile(pathForUri(root, first.uri), "utf8")).toBe("identical source text");
  });

  it("reads a committed object after reopening", async () => {
    const root = await casRoot();
    const first = await FileSystemCas.open(root);
    const stored = await first.put("Readable after restart.");

    const reopened = await FileSystemCas.open(root);
    expect(Buffer.from(await reopened.get(stored.uri)).toString("utf8")).toBe(
      "Readable after restart.",
    );
  });

  it("can restrict a sensitive CAS root and its objects to the owner", async () => {
    const root = await casRoot();
    const cas = await OwnerOnlyFileSystemCas.open(root);
    const stored = await cas.put("Private request source text");

    expect((await stat(root)).mode & 0o777).toBe(0o700);
    expect((await stat(pathForUri(root, stored.uri))).mode & 0o777).toBe(0o600);
  });

  it("lists owner-only objects with a stable cursor and deletes idempotently", async () => {
    const root = await casRoot();
    const cas = await OwnerOnlyFileSystemCas.open(root);
    const stored = await Promise.all(["three", "one", "two"].map((value) => cas.put(value)));
    const observedAt = new Date("2026-08-20T00:00:00.000Z");
    await Promise.all(
      stored.map((item) => utimes(pathForUri(root, item.uri), observedAt, observedAt)),
    );

    const first = await cas.listObjects({ limit: 2 });
    const second = await cas.listObjects({ after: first.nextCursor!, limit: 2 });
    const listed = [...first.items, ...second.items];

    expect(listed.map((item) => item.uri)).toEqual(stored.map((item) => item.uri).sort());
    expect(listed.every((item) => item.modifiedAt === observedAt.toISOString())).toBe(true);
    expect(first.nextCursor).toBe(first.items.at(-1)!.uri);
    expect(second.nextCursor).toBeNull();
    await expect(cas.deleteObject(listed[0]!.uri)).resolves.toEqual({ deleted: true });
    await expect(cas.deleteObject(listed[0]!.uri)).resolves.toEqual({ deleted: false });
    await expect(cas.has(listed[0]!.uri)).resolves.toBe(false);
  });

  it("bounds owner-only inventory work and validates its cursor", async () => {
    const cas = await OwnerOnlyFileSystemCas.open(await casRoot());
    await Promise.all(["a", "b"].map((value) => cas.put(value)));

    await expect(cas.listObjects({ limit: 1, maximumScannedObjects: 1 })).rejects.toMatchObject({
      code: "capacity_exceeded",
    });
    await expect(cas.listObjects({ after: "file:///tmp/not-cas" })).rejects.toMatchObject({
      code: "invalid_uri",
    });
  });

  it("detects content that no longer matches its address", async () => {
    const root = await casRoot();
    const cas = await FileSystemCas.open(root);
    const stored = await cas.put("original");
    await writeFile(pathForUri(root, stored.uri), "tampered", "utf8");

    await expect(cas.get(stored.uri)).rejects.toMatchObject({ code: "corrupt_object" });
    await expect(cas.has(stored.uri)).rejects.toMatchObject({ code: "corrupt_object" });
  });

  it("returns false only when a valid address is absent", async () => {
    const cas = await FileSystemCas.open(await casRoot());
    await expect(cas.has(`lervo-cas://sha256/${"a".repeat(64)}`)).resolves.toBe(false);
    await expect(cas.get(`lervo-cas://sha256/${"a".repeat(64)}`)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("commits one object when concurrent writers store identical bytes", async () => {
    const cas = await FileSystemCas.open(await casRoot());
    const results = await Promise.all(Array.from({ length: 8 }, () => cas.put("concurrent write")));
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.uri))).toHaveLength(1);
  });

  it("stores a chunked input without requiring one in-memory body", async () => {
    const cas = await FileSystemCas.open(await casRoot());
    const result = await cas.putStream(
      (async function* () {
        yield "Store ";
        yield Buffer.from("large source text ", "utf8");
        yield "in chunks.";
      })(),
    );

    expect(result.byteCount).toBe(Buffer.byteLength("Store large source text in chunks."));
    expect(Buffer.from(await cas.get(result.uri)).toString("utf8")).toBe(
      "Store large source text in chunks.",
    );
  });

  it("removes the temporary file when a chunked producer fails", async () => {
    const root = await casRoot();
    const cas = await FileSystemCas.open(root);
    const failed = (async function* () {
      yield "partial";
      throw new Error("producer failed");
    })();

    await expect(cas.putStream(failed)).rejects.toThrow("producer failed");
    expect(await readdir(resolve(root, ".tmp"))).toEqual([]);
  });

  it("rejects malformed addresses without resolving arbitrary paths", async () => {
    const root = await casRoot();
    const cas = await FileSystemCas.open(root);

    await expect(cas.get("lervo-cas://sha256/../../secret")).rejects.toBeInstanceOf(CasError);
    await expect(cas.get("lervo-cas://sha256/../../secret")).rejects.toMatchObject({
      code: "invalid_uri",
    });
  });
});
