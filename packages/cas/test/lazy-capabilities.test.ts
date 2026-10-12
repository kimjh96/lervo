import { mkdtemp, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as durability from "@lervo/filesystem-durability";
import * as native from "../src/native-cas.js";
import { FileSystemCas } from "../src/index.js";
const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function root() {
  const path = await mkdtemp(resolve(tmpdir(), "lervo-cas-lazy-"));
  roots.push(path);
  return path;
}
it("validates open paths without constructing unused native capabilities", async () => {
  const sync = vi.spyOn(durability, "createFileSyncBatch"),
    loader = vi.spyOn(native, "loadNativeCas");
  const path = await root();
  const cas = await FileSystemCas.open(path);
  const reader = await FileSystemCas.openReadOnly(path);
  await expect(cas.get("invalid")).rejects.toMatchObject({ code: "invalid_uri" });
  await expect(reader.put("blocked")).rejects.toMatchObject({ code: "read_only" });
  expect(sync).not.toHaveBeenCalled();
  expect(loader).not.toHaveBeenCalled();
  const redirected = await root();
  await mkdir(resolve(redirected, "owner"));
  await symlink(resolve(redirected, "owner"), resolve(redirected, "sha256"), "dir");
  await expect(FileSystemCas.open(redirected)).rejects.toMatchObject({ code: "unsafe_path" });
  expect(sync).not.toHaveBeenCalled();
  expect(loader).not.toHaveBeenCalled();
});
it("initializes each used capability once per handle and retains complete ordinary fallback", async () => {
  const original = durability.createFileSyncBatch;
  const sync = vi
    .spyOn(durability, "createFileSyncBatch")
    .mockImplementation(() => original({ synchronize: async () => false }));
  const loader = vi.spyOn(native, "loadNativeCas").mockReturnValue(undefined);
  const path = await root(),
    cas = await FileSystemCas.open(path);
  const report = await cas.put("complete object");
  expect(await cas.get(report.uri)).toEqual(Buffer.from("complete object"));
  expect(await cas.has(report.uri)).toBe(true);
  expect(sync).toHaveBeenCalledTimes(1);
  expect(loader).toHaveBeenCalledTimes(1);
  const reader = await FileSystemCas.openReadOnly(path);
  expect(await reader.get(report.uri)).toEqual(Buffer.from("complete object"));
  expect(sync).toHaveBeenCalledTimes(1);
  expect(loader).toHaveBeenCalledTimes(2);
});
it("propagates capability initialization failure at first use without a success receipt", async () => {
  const loader = vi.spyOn(native, "loadNativeCas").mockReturnValue(undefined);
  const path = await root(),
    seed = await FileSystemCas.open(path),
    report = await seed.put("existing");
  loader.mockImplementation(() => {
    throw new Error("invalid native asset");
  });
  const reader = await FileSystemCas.openReadOnly(path);
  await expect(reader.get(report.uri)).rejects.toThrow("invalid native asset");
  const writer = await FileSystemCas.open(path);
  vi.spyOn(durability, "createFileSyncBatch").mockImplementation(() => {
    throw new Error("invalid synchronization asset");
  });
  await expect(writer.put("new")).rejects.toThrow("invalid synchronization asset");
});
