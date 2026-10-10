import { createHash } from "node:crypto";
import { copyFile, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { loadNativeCas } from "../src/native-cas.js";
import { compileNative } from "./native-fixture.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cas-loader-"));
  roots.push(root);
  const bytes = Buffer.from("synthetic binary"),
    manifest = {
      schemaVersion: 1,
      apiVersion: 1,
      napiVersion: 8,
      platform: "darwin",
      architectures: ["arm64", "x64"],
      sourceHash: `sha256:${"a".repeat(64)}`,
      contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    };
  const binary = resolve(root, "cas-io-darwin.node"),
    metadata = resolve(root, "cas-io.json");
  await writeFile(binary, bytes);
  await writeFile(metadata, JSON.stringify(manifest));
  return { root, base: pathToFileURL(root + "/"), binary, metadata, manifest };
}

it("keeps unsupported hosts and absent capabilities on ordinary I/O", async () => {
  const { base, binary, metadata } = await fixture(),
    load = vi.fn();
  for (const platform of ["linux", "win32"] as const)
    expect(loadNativeCas(platform, base, load)).toBeUndefined();
  expect(loadNativeCas("darwin", base, load, "unsupported")).toBeUndefined();
  await rm(binary);
  await rm(metadata);
  expect(loadNativeCas("darwin", base, load, "arm64")).toBeUndefined();
  expect(load).not.toHaveBeenCalled();
});

it("verifies manifest and binary bytes before loading", async () => {
  const { base, binary } = await fixture(),
    batch = vi.fn(async () => []),
    load = vi.fn(() => ({ batch }));
  await loadNativeCas("darwin", base, load, "arm64")!.batch([["/body"]]);
  expect(batch).toHaveBeenCalledWith([["/body"]]);
  await writeFile(binary, "changed");
  expect(() => loadNativeCas("darwin", base, load, "arm64")).toThrow("artifact changed");
  expect(load).toHaveBeenCalledTimes(1);
});

it("fails closed on either partial capability and malformed manifest", async () => {
  const { base, binary, metadata, manifest } = await fixture(),
    load = vi.fn();
  for (const value of [
    null,
    {},
    { ...manifest, apiVersion: 2 },
    { ...manifest, architectures: ["arm64"] },
    { ...manifest, sourceHash: "invalid" },
  ]) {
    await writeFile(metadata, JSON.stringify(value));
    expect(() => loadNativeCas("darwin", base, load, "arm64")).toThrow("manifest");
  }
  await rm(metadata);
  expect(() => loadNativeCas("darwin", base, load, "arm64")).toThrow("manifest is missing");
  await writeFile(metadata, JSON.stringify(manifest));
  await rm(binary);
  expect(() => loadNativeCas("darwin", base, load, "arm64")).toThrow();
  expect(load).not.toHaveBeenCalled();
});

it("rejects oversized or linked assets before loading", async () => {
  const { base, binary, metadata, manifest, root } = await fixture(),
    load = vi.fn();
  await writeFile(metadata, " ".repeat(4097));
  expect(() => loadNativeCas("darwin", base, load, "arm64")).toThrow("asset");
  await writeFile(metadata, JSON.stringify(manifest));
  await writeFile(binary, Buffer.alloc(1048577));
  expect(() => loadNativeCas("darwin", base, load, "arm64")).toThrow("asset");
  await rm(binary);
  await symlink(metadata, binary);
  expect(() => loadNativeCas("darwin", base, load, "arm64")).toThrow("asset");
  await rm(metadata);
  const target = resolve(root, "manifest-target");
  await writeFile(target, JSON.stringify(manifest));
  await symlink(target, metadata);
  expect(() => loadNativeCas("darwin", base, load, "arm64")).toThrow("asset");
  expect(load).not.toHaveBeenCalled();
  const alias = resolve(root, "linked-directory");
  await symlink(root, alias, "junction");
  expect(() => loadNativeCas("darwin", pathToFileURL(alias + "/"), load, "arm64")).toThrow(
    "asset directory",
  );
});

it("falls back for an unsupported host ABI but propagates other loader failures", async () => {
  const { base } = await fixture();
  expect(
    loadNativeCas(
      "darwin",
      base,
      () => {
        throw Object.assign(new Error("ABI"), { code: "ERR_DLOPEN_FAILED" });
      },
      "arm64",
    ),
  ).toBeUndefined();
  expect(() => loadNativeCas("darwin", base, () => ({}), "arm64")).toThrow("contract");
  const error = new Error("unexpected");
  expect(() =>
    loadNativeCas(
      "darwin",
      base,
      () => {
        throw error;
      },
      "arm64",
    ),
  ).toThrow(error);
});

it.runIf(process.platform === "darwin")(
  "loads the compiled kernel through its checked private asset boundary",
  async () => {
    const { root, base, binary, metadata, manifest } = await fixture();
    const built = await compileNative(root, "actual");
    await copyFile(built.binary, binary);
    await writeFile(
      metadata,
      JSON.stringify({
        ...manifest,
        contentHash: `sha256:${createHash("sha256")
          .update(await readFile(binary))
          .digest("hex")}`,
      }),
    );
    const path = resolve(root, "body");
    await writeFile(path, "actual readback");
    const native = loadNativeCas("darwin", base);
    expect(native).toBeDefined();
    expect(await native!.batch([[path]])).toEqual([
      { status: "complete", created: false, bytes: Buffer.from("actual readback") },
    ]);
  },
);
