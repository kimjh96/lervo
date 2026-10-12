import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile, open, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { loadNativeFileSync } from "../src/native-file-sync.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-native-sync-"));
  roots.push(root);
  const bytes = Buffer.from("test binary"),
    manifest = {
      schemaVersion: 1,
      apiVersion: 1,
      napiVersion: 8,
      platform: "darwin",
      architectures: ["arm64", "x64"],
      sourceHash: `sha256:${"a".repeat(64)}`,
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    };
  await writeFile(resolve(root, "file-sync-darwin.node"), bytes);
  await writeFile(resolve(root, "file-sync.json"), JSON.stringify(manifest));
  return { root, manifest, base: pathToFileURL(root + "/") };
}

it("avoids native loading on unsupported platforms and absent capabilities", async () => {
  const load = vi.fn(),
    missing = pathToFileURL(resolve(tmpdir(), "missing-native-capability") + "/");
  expect(loadNativeFileSync("linux", missing, load)).toBeUndefined();
  expect(loadNativeFileSync("win32", missing, load)).toBeUndefined();
  expect(loadNativeFileSync("darwin", missing, load, "unsupported")).toBeUndefined();
  expect(loadNativeFileSync("darwin", missing, load)).toBeUndefined();
  expect(load).not.toHaveBeenCalled();
});

it("checks manifest and binary identity before loading the adapter", async () => {
  const { root, base } = await fixture(),
    synchronize = vi.fn(async () => true);
  const load = vi.fn(() => ({ synchronize }));
  const native = loadNativeFileSync("darwin", base, load)!;
  expect(await native.synchronize([1])).toBe(true);
  expect(synchronize).toHaveBeenCalledExactlyOnceWith([1]);
  await writeFile(resolve(root, "file-sync-darwin.node"), "changed");
  expect(() => loadNativeFileSync("darwin", base, load)).toThrow("artifact changed");
  expect(load).toHaveBeenCalledTimes(1);
});

it("rejects unsupported manifests and incomplete or invalid declared capabilities", async () => {
  const { root, base, manifest } = await fixture(),
    load = vi.fn(() => ({}));
  await writeFile(
    resolve(root, "file-sync.json"),
    JSON.stringify({ ...manifest, napiVersion: 99 }),
  );
  expect(() => loadNativeFileSync("darwin", base, load)).toThrow("manifest");
  expect(load).not.toHaveBeenCalled();
  await writeFile(resolve(root, "file-sync.json"), JSON.stringify(manifest));
  expect(() => loadNativeFileSync("darwin", base, load)).toThrow("contract");
  await rm(resolve(root, "file-sync-darwin.node"));
  expect(() => loadNativeFileSync("darwin", base, load)).toThrow();
});

it.runIf(process.platform === "darwin")(
  "uses the built native adapter with owned descriptors and rejects invalid input",
  async () => {
    const { root } = await fixture();
    const native = loadNativeFileSync("darwin", new URL("../dist/native/", import.meta.url));
    expect(native).toBeDefined();
    const files = await Promise.all(["a", "b"].map((name) => open(resolve(root, name), "wx")));
    try {
      await Promise.all(files.map((file, i) => file.writeFile(`content-${i}`)));
      for (const bad of [files[0]!.fd + 0.5, files[0]!.fd + 2 ** 32, NaN, Infinity, -1])
        expect(() => native!.synchronize([bad])).toThrow();
      expect(() => native!.synchronize([])).toThrow();
      expect(() => native!.synchronize(Array(17).fill(files[0]!.fd))).toThrow();
      const pending = native!.synchronize(files.map((file) => file.fd));
      await Promise.all(files.map((file) => file.close()));
      expect(await pending).toBe(true);
      expect(await readFile(resolve(root, "a"), "utf8")).toBe("content-0");
      expect(await readFile(resolve(root, "b"), "utf8")).toBe("content-1");
    } finally {
      await Promise.all(files.map((file) => file.close()));
    }
    const directory = await open(root, "r");
    try {
      await expect(native!.synchronize([directory.fd])).rejects.toMatchObject({
        code: "file_sync_failed",
      });
    } finally {
      await directory.close();
    }
  },
);

it("retains ordinary synchronization when a verified binary cannot load on the host ABI", async () => {
  const { base } = await fixture();
  const load = vi.fn(() => {
    throw Object.assign(new Error("Unsupported host"), { code: "ERR_DLOPEN_FAILED" });
  });
  expect(loadNativeFileSync("darwin", base, load)).toBeUndefined();
  expect(load).toHaveBeenCalledTimes(1);
});
