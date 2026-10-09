import { mkdir, mkdtemp, open, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { deserialize, serialize } from "node:v8";

import { afterEach, describe, expect, it } from "vitest";
import { sha256 } from "../src/integrity.js";
import {
  preparationCachePath,
  readPreparationCache,
  writePreparationCache,
} from "../src/preparation-cache-file.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const path = await mkdtemp(resolve(tmpdir(), "lervo-preparation-cache-"));
  roots.push(path);
  return path;
}

describe("preparation cache persistence", () => {
  it("roundtrips across owners, rejects changed or truncated payloads, and rebuilds after deletion", async () => {
    const path = await root();
    expect(await readPreparationCache(path, "source-units")).toBeNull();
    const value = { units: ["first", "한글"] };
    await writePreparationCache(path, "source-units", value);
    expect(await readPreparationCache(path, "source-units")).toEqual(value);
    const cachePath = resolve(path, preparationCachePath("source-units"));
    const bytes = await readFile(cachePath);
    bytes[bytes.length - 3] = 0x78;
    await writeFile(cachePath, bytes);
    expect(await readPreparationCache(path, "source-units")).toBeNull();
    await writeFile(cachePath, bytes.subarray(0, 80));
    expect(await readPreparationCache(path, "source-units")).toBeNull();
    await rm(resolve(path, ".lervo/state"), { recursive: true });
    await writePreparationCache(path, "source-units", value);
    expect(await readPreparationCache(path, "source-units")).toEqual(value);
  });

  it("does not follow a symbolic state directory or cache file", async () => {
    const path = await root();
    const outside = await root();
    await mkdir(resolve(path, ".lervo"));
    await symlink(outside, resolve(path, ".lervo/state"));
    await writePreparationCache(path, "source-units", { ignored: true });
    expect(await readdir(outside)).toEqual([]);
    expect(await readPreparationCache(path, "source-units")).toBeNull();
    await rm(resolve(path, ".lervo/state"));
    const cachePath = resolve(path, preparationCachePath("source-units"));
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(resolve(outside, "target"), "original");
    await symlink(resolve(outside, "target"), cachePath);
    expect(await readPreparationCache(path, "source-units")).toBeNull();
    await writePreparationCache(path, "source-units", { replaced: true });
    expect(await readFile(resolve(outside, "target"), "utf8")).toBe("original");
  });

  it("rejects incompatible runtimes and oversized files, and tolerates an unavailable directory", async () => {
    const path = await root();
    const cachePath = resolve(path, preparationCachePath("ranker"));
    await mkdir(dirname(cachePath), { recursive: true });
    const payload = serialize({ schemaVersion: 2, runtime: "old-runtime", value: {} });
    await writeFile(cachePath, Buffer.concat([Buffer.from(`${sha256(payload)}\n`), payload]));
    expect(await readPreparationCache(path, "ranker")).toBeNull();
    const handle = await open(cachePath, "w");
    try {
      await handle.truncate(128 * 1024 * 1024 + 1);
    } finally {
      await handle.close();
    }
    expect(await readPreparationCache(path, "ranker")).toBeNull();
    await rm(resolve(path, ".lervo/state"), { recursive: true });
    await writeFile(resolve(path, ".lervo/state"), "unavailable");
    await expect(writePreparationCache(path, "ranker", {})).resolves.toBeUndefined();
    expect(await readPreparationCache(path, "ranker")).toBeNull();
  });

  it("rebuilds legacy JSON and invalid binary envelopes without changing Unicode or tuple values", async () => {
    const path = await root();
    const cachePath = resolve(path, preparationCachePath("source-units"));
    await mkdir(dirname(cachePath), { recursive: true });
    const oldPayload = JSON.stringify({
      schemaVersion: 1,
      runtime: `${process.versions.node}/${process.versions.unicode}/${process.versions.icu}`,
      value: { old: true },
    });
    await writeFile(cachePath, `${sha256(oldPayload)}\n${oldPayload}`);
    expect(await readPreparationCache(path, "source-units")).toBeNull();
    const value = {
      entries: [["한글 😀", [0, 42, null, String.fromCharCode(0xd800), "e\u0301"]]],
      frequencies: new Map([["한글", 2]]),
    };
    await writePreparationCache(path, "source-units", value);
    expect(await readPreparationCache(path, "source-units")).toEqual(value);
    const stored = await readFile(cachePath);
    const envelope = deserialize(stored.subarray(72));
    expect(envelope.schemaVersion).toBe(2);
    for (const payload of [
      serialize({ ...envelope, schemaVersion: 999 }),
      Buffer.from("invalid"),
    ]) {
      await writeFile(cachePath, Buffer.concat([Buffer.from(`${sha256(payload)}\n`), payload]));
      expect(await readPreparationCache(path, "source-units")).toBeNull();
    }
  });

  it("recovers interrupted temporary files and tolerates racing projection writers", async () => {
    const path = await root();
    const directory = dirname(resolve(path, preparationCachePath("source-units")));
    await mkdir(directory, { recursive: true });
    const abandoned = ".source-units-00000000-0000-0000-0000-000000000000.tmp";
    await writeFile(resolve(directory, abandoned), "incomplete");
    const values = Array.from({ length: 8 }, (_, index) => ({ index, payload: "x".repeat(4096) }));
    await Promise.all(values.map((value) => writePreparationCache(path, "source-units", value)));
    const loaded = await readPreparationCache(path, "source-units");
    if (loaded !== null) expect(values).toContainEqual(loaded);
    await writePreparationCache(path, "source-units", values[0]);
    expect(await readPreparationCache(path, "source-units")).toEqual(values[0]);
    expect(await readdir(directory)).toEqual(["source-units.cache"]);
  });
});
