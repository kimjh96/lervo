import { promisify } from "node:util";
import { execFile, execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("node:child_process", async (original) => ({
  ...(await original()),
  execFileSync: vi.fn(() => "a".repeat(40)),
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original();
  return { ...fs, mkdir: vi.fn(fs.mkdir) };
});
import { nativeFileSyncFixture } from "./native-file-sync-fixture.mjs";
import { nativeFileSyncSourceHash } from "../../shared/native-file-sync-artifact.mjs";
import { nativeFileSyncDigest } from "../../shared/native-file-sync-contract.mjs";
import {
  createNativeFileSyncTransfer,
  restoreNativeFileSyncTransfer,
} from "../lib/native-file-sync-transfer.mjs";
let root, repositoryRoot, artifactDirectory, native;
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-native-transfer-"));
  repositoryRoot = resolve(root, "repository");
  artifactDirectory = resolve(root, "transfer");
  vi.mocked(execFileSync).mockReturnValue("a".repeat(40));
  vi.stubEnv("GITHUB_WORKFLOW", "fixture");
  vi.stubEnv("GITHUB_RUN_ID", "123");
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "1");
  for (const path of [
    "packages/filesystem-durability/native/binding.c",
    "packages/filesystem-durability/native/sync-group.c",
    "packages/filesystem-durability/native/sync-group.h",
    "packages/filesystem-durability/scripts/build-native.mjs",
    "scripts/shared/native-file-sync-contract.mjs",
    "scripts/shared/native-file-sync-artifact.mjs",
  ]) {
    const target = resolve(repositoryRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(import.meta.dirname, "../../..", path), target);
  }
  native = nativeFileSyncFixture();
  native.manifest.sourceHash = await nativeFileSyncSourceHash(repositoryRoot);
  const output = resolve(repositoryRoot, "packages/filesystem-durability/dist/native");
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, "file-sync.json"), JSON.stringify(native.manifest));
  await writeFile(resolve(output, "file-sync-darwin.node"), native.binary);
});
afterEach(async () => {
  vi.mocked(mkdir).mockReset();
  vi.mocked(mkdir).mockImplementation((await vi.importActual("node:fs/promises")).mkdir);
  vi.unstubAllEnvs();
  await rm(root, { recursive: true, force: true });
});
const input = () => ({ repositoryRoot, artifactDirectory });
it.each(["binary", "manifest-bytes"])(
  "rejects changed %s between transfer admission and copy without replacing prior bytes",
  async (kind) => {
    await createNativeFileSyncTransfer(input());
    const output = resolve(repositoryRoot, "packages/filesystem-durability/dist");
    const priorManifest = await readFile(resolve(output, "native/file-sync.json"));
    const actual = await vi.importActual("node:fs/promises");
    let changed = false;
    vi.mocked(mkdir).mockImplementation(async (path, options) => {
      if (path === output && !changed) {
        changed = true;
        const binary = Buffer.from(native.binary);
        if (kind === "binary") binary[111] = 7;
        await writeFile(resolve(artifactDirectory, "native/file-sync-darwin.node"), binary);
        await writeFile(
          resolve(artifactDirectory, "native/file-sync.json"),
          JSON.stringify({ ...native.manifest, contentHash: nativeFileSyncDigest(binary) }) + "\n",
        );
      }
      return actual.mkdir(path, options);
    });
    await expect(restoreNativeFileSyncTransfer(input())).rejects.toThrow(
      "native_transfer_digest_mismatch",
    );
    expect(changed).toBe(true);
    expect(await readFile(resolve(output, "native/file-sync-darwin.node"))).toEqual(native.binary);
    expect(await readFile(resolve(output, "native/file-sync.json"))).toEqual(priorManifest);
  },
);
it("publishes the admitted pair if transfer files change after the copy reads them", async () => {
  const receipt = await createNativeFileSyncTransfer(input());
  const output = resolve(repositoryRoot, "packages/filesystem-durability/dist");
  const priorManifest = await readFile(resolve(output, "native/file-sync.json"));
  const actual = await vi.importActual("node:fs/promises");
  let changed = false;
  vi.mocked(mkdir).mockImplementation(async (path, options) => {
    if (path === resolve(output, ".native-copy")) {
      changed = true;
      await writeFile(resolve(artifactDirectory, "native/file-sync-darwin.node"), "changed");
      await writeFile(resolve(artifactDirectory, "native/file-sync.json"), "changed");
    }
    return actual.mkdir(path, options);
  });
  expect(await restoreNativeFileSyncTransfer(input())).toEqual(receipt);
  expect(changed).toBe(true);
  expect(await readFile(resolve(output, "native/file-sync-darwin.node"))).toEqual(native.binary);
  expect(await readFile(resolve(output, "native/file-sync.json"))).toEqual(priorManifest);
});
it("restores the exact pair and permits a producer from an earlier attempt of the same run", async () => {
  const created = await createNativeFileSyncTransfer(input());
  await rm(resolve(repositoryRoot, "packages/filesystem-durability/dist/native"), {
    recursive: true,
  });
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
  expect(await restoreNativeFileSyncTransfer(input())).toEqual(created);
  expect(
    await readFile(
      resolve(repositoryRoot, "packages/filesystem-durability/dist/native/file-sync-darwin.node"),
    ),
  ).toEqual(native.binary);
  await expect(createNativeFileSyncTransfer(input())).rejects.toMatchObject({ code: "EEXIST" });
});
it.each(["revision", "workflow", "runId", "future-attempt", "source", "binary", "pair-digest"])(
  "rejects %s before replacing destination bytes",
  async (kind) => {
    await createNativeFileSyncTransfer(input());
    const receiptPath = resolve(artifactDirectory, "receipt.json"),
      receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    if (kind === "revision") receipt.revision = "b".repeat(40);
    if (kind === "workflow") receipt.workflow = "other";
    if (kind === "runId") receipt.runId = "other";
    if (kind === "future-attempt") receipt.runAttempt = "2";
    if (kind === "source")
      await writeFile(
        resolve(repositoryRoot, "packages/filesystem-durability/native/binding.c"),
        "changed",
      );
    if (kind === "binary")
      await writeFile(resolve(artifactDirectory, "native/file-sync-darwin.node"), "changed");
    if (kind === "pair-digest") {
      const binary = Buffer.from(native.binary);
      binary[111] = 1;
      await writeFile(resolve(artifactDirectory, "native/file-sync-darwin.node"), binary);
      await writeFile(
        resolve(artifactDirectory, "native/file-sync.json"),
        JSON.stringify({ ...native.manifest, contentHash: nativeFileSyncDigest(binary) }),
      );
    }
    await writeFile(receiptPath, JSON.stringify(receipt));
    await expect(restoreNativeFileSyncTransfer(input())).rejects.toThrow();
    expect(
      await readFile(
        resolve(repositoryRoot, "packages/filesystem-durability/dist/native/file-sync-darwin.node"),
      ),
    ).toEqual(native.binary);
  },
);

it.skipIf(process.platform !== "darwin")(
  "reuses exact transferred bytes without invoking a compiler",
  async () => {
    await promisify(execFile)(
      process.execPath,
      [resolve(repositoryRoot, "packages/filesystem-durability/scripts/build-native.mjs")],
      { env: { ...process.env, PATH: resolve(root, "no-compiler") } },
    );
    expect(
      await readFile(
        resolve(repositoryRoot, "packages/filesystem-durability/dist/native/file-sync-darwin.node"),
      ),
    ).toEqual(native.binary);
  },
);
it.skipIf(process.platform !== "darwin")(
  "retries a fresh empty build after compiler failure without retaining a growing stage",
  async () => {
    const output = resolve(repositoryRoot, "packages/filesystem-durability/dist/native");
    await rm(output, { recursive: true });
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(
        promisify(execFile)(
          process.execPath,
          [resolve(repositoryRoot, "packages/filesystem-durability/scripts/build-native.mjs")],
          { env: { ...process.env, PATH: resolve(root, "no-compiler") } },
        ),
      ).rejects.toMatchObject({ stderr: expect.stringContaining("spawn xcrun ENOENT") });
      expect(await (await import("node:fs/promises")).readdir(output)).toEqual([]);
    }
  },
);
