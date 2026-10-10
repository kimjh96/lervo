import { createHash } from "node:crypto";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import * as durability from "@lervo/filesystem-durability";
import { FileSystemCas } from "../src/index.js";
import * as nativeLoader from "../src/native-cas.js";
import { compileNative } from "./native-fixture.js";

const createSync = durability.createFileSyncBatch;
const uri = (body: string | Buffer) =>
  `lervo-cas://sha256/${createHash("sha256").update(body).digest("hex")}`;
const objectPath = (root: string, address: string) => {
  const hash = address.slice("lervo-cas://sha256/".length);
  return resolve(root, "sha256", hash.slice(0, 2), hash.slice(2));
};

describe.runIf(process.platform === "darwin")("native CAS composition", () => {
  let buildRoot: string, native: nativeLoader.NativeCas;
  const roots: string[] = [];
  beforeAll(async () => {
    buildRoot = await mkdtemp(resolve(tmpdir(), "lervo-cas-integration-native-"));
    native = (await compileNative(buildRoot, "cas")).native as nativeLoader.NativeCas;
  });
  afterAll(async () => {
    await rm(buildRoot, { recursive: true, force: true });
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
  async function fixture(adapter: nativeLoader.NativeCas = native) {
    vi.spyOn(nativeLoader, "loadNativeCas").mockReturnValue(adapter);
    const root = await mkdtemp(resolve(tmpdir(), "lervo-cas-integration-"));
    roots.push(root);
    return { root, cas: await FileSystemCas.open(root) };
  }

  it("publishes only after synchronization and freshly verifies subsequent reads", async () => {
    let entered!: () => void, release!: (value: boolean) => void;
    const started = new Promise<void>((r) => {
        entered = r;
      }),
      finish = new Promise<boolean>((r) => {
        release = r;
      });
    vi.spyOn(durability, "createFileSyncBatch").mockImplementation(() =>
      createSync({
        synchronize: async () => {
          entered();
          return finish;
        },
      }),
    );
    const batch = vi.fn((operations: readonly nativeLoader.NativeCasOperation[]) =>
      native.batch(operations),
    );
    const { root, cas } = await fixture({ batch });
    const body = "after sync",
      pending = cas.put(body);
    await started;
    expect(
      batch.mock.calls.flatMap(([operations]) => operations).filter((op) => op.length === 3),
    ).toEqual([]);
    expect(await readdir(resolve(root, ".tmp"))).toHaveLength(1);
    release(true);
    const receipt = await pending;
    expect(
      batch.mock.calls.flatMap(([operations]) => operations).filter((op) => op.length === 3),
    ).toHaveLength(1);
    expect(await readdir(resolve(root, ".tmp"))).toEqual([]);
    await writeFile(objectPath(root, receipt.uri), "tampered");
    await expect(cas.get(receipt.uri)).rejects.toMatchObject({ code: "corrupt_object" });
  });

  it("keeps stream and large publication ordinary and fully rereads large objects", async () => {
    const batch = vi.fn((operations: readonly nativeLoader.NativeCasOperation[]) =>
      native.batch(operations),
    );
    const { root, cas } = await fixture({ batch });
    const streamed = await cas.putStream(
      (async function* () {
        yield "stream";
      })(),
    );
    const bytes = Buffer.alloc(65537, 42),
      large = await cas.put(bytes);
    expect(
      batch.mock.calls.flatMap(([operations]) => operations).every((op) => op.length === 1),
    ).toBe(true);
    expect(Buffer.from(await cas.get(large.uri))).toEqual(bytes);
    expect(Buffer.from(await cas.get(streamed.uri)).toString()).toBe("stream");
    bytes[bytes.length - 1] = 99;
    await writeFile(objectPath(root, large.uri), bytes);
    await expect(cas.get(large.uri)).rejects.toMatchObject({ code: "corrupt_object" });
  });

  it("preserves recursive-parent recovery before native publication has begun", async () => {
    const { root, cas } = await fixture();
    await rm(resolve(root, "sha256"), { recursive: true });
    const receipt = await cas.put("restored parent");
    expect(receipt.created).toBe(true);
    expect(Buffer.from(await cas.get(receipt.uri)).toString()).toBe("restored parent");
  });

  it("falls back on pre-admission capacity without losing publication metadata", async () => {
    const batch = vi.fn(() => {
      throw Object.assign(new Error("capacity"), { code: "native_cas_capacity" });
    });
    const { root, cas } = await fixture({ batch });
    const receipt = await cas.put("overflow");
    expect(receipt.created).toBe(true);
    expect((await cas.put("overflow")).created).toBe(false);
    expect(Buffer.from(await cas.get(receipt.uri)).toString()).toBe("overflow");
    expect(await readdir(resolve(root, ".tmp"))).toEqual([]);
  });

  it("propagates admitted failures and cleans each temporary file without publication retry", async () => {
    const failure = Object.assign(new Error("I/O failed"), { code: "EIO" });
    const batch = vi.fn(async () => {
      throw failure;
    });
    const { root, cas } = await fixture({ batch });
    const results = await Promise.allSettled([cas.put("failed-a"), cas.put("failed-b")]);
    expect(results).toEqual(
      Array.from({ length: 2 }, () => ({ status: "rejected", reason: failure })),
    );
    expect(await readdir(resolve(root, ".tmp"))).toEqual([]);
    expect(await readdir(resolve(root, "sha256"))).toEqual([]);
  });

  it("rejects an existing oversized target instead of returning truncated or invented content", async () => {
    const { root, cas } = await fixture(),
      body = "small expected body",
      receipt = await cas.put(body);
    await writeFile(objectPath(root, receipt.uri), Buffer.alloc(65537, 97));
    await expect(cas.put(body)).rejects.toMatchObject({ code: "corrupt_object" });
    expect(await readdir(resolve(root, ".tmp"))).toEqual([]);
    const reader = await FileSystemCas.openReadOnly(root);
    await expect(reader.put("no writes")).rejects.toMatchObject({ code: "read_only" });
    expect(await reader.has(uri("missing"))).toBe(false);
  });
});
