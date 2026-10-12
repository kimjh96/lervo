import { nativeFileSyncFixture } from "./native-file-sync-fixture.mjs";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (original) => {
  const fs = await original();
  return { ...fs, rename: vi.fn(fs.rename) };
});
import {
  copyNativeFileSyncArtifact,
  readNativeFileSyncArtifact,
} from "../../shared/native-file-sync-artifact.mjs";
import {
  nativeFileSyncDigest,
  validateNativeFileSyncArtifact,
  validateNativeFileSyncSbom,
} from "../../shared/native-file-sync-contract.mjs";
import {
  createHubDistributionSbom,
  createNodeDistributionSbom,
} from "../lib/runtime-distribution-sbom.mjs";

let root, source, output, binary, manifest;
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-native-artifact-test-"));
  source = resolve(root, "source");
  output = resolve(root, "output");
  await Promise.all([mkdir(source), mkdir(output)]);
  ({ binary, manifest } = nativeFileSyncFixture());
  await persist();
});
afterEach(async () => {
  vi.clearAllMocks();
  await rm(root, { recursive: true, force: true });
});
async function persist() {
  await writeFile(resolve(source, "file-sync-darwin.node"), binary);
  await writeFile(resolve(source, "file-sync.json"), JSON.stringify(manifest));
}

it("copies exactly the verified pair and safely replaces a prior artifact", async () => {
  await copyNativeFileSyncArtifact(source, output, {
    required: true,
    expectedSourceHash: manifest.sourceHash,
  });
  binary[111] = 7;
  manifest.contentHash = nativeFileSyncDigest(binary);
  await persist();
  await copyNativeFileSyncArtifact(source, output);
  expect(await readFile(resolve(output, "native/file-sync-darwin.node"))).toEqual(binary);
  expect(await readdir(output)).toEqual(["native"]);
});
it("distinguishes absent optional support from missing required support and removes owned stale output", async () => {
  await copyNativeFileSyncArtifact(source, output);
  await rm(source, { recursive: true });
  await expect(copyNativeFileSyncArtifact(source, output, { required: true })).rejects.toThrow(
    "missing",
  );
  expect(await readdir(output)).toEqual(["native"]);
  expect(await copyNativeFileSyncArtifact(source, output)).toBeUndefined();
  expect(await readdir(output)).toEqual([]);
});
it.each(["hash", "source", "incomplete", "extra", "directory-link", "file-link"])(
  "rejects %s without changing the prior output",
  async (kind) => {
    await copyNativeFileSyncArtifact(source, output);
    const prior = await readFile(resolve(output, "native/file-sync-darwin.node"));
    if (kind === "hash") await writeFile(resolve(source, "file-sync-darwin.node"), "changed");
    if (kind === "source") {
      manifest.sourceHash = `sha256:${"b".repeat(64)}`;
      await persist();
    }
    if (kind === "incomplete") await rm(resolve(source, "file-sync.json"));
    if (kind === "extra") await writeFile(resolve(source, "unexpected"), "x");
    if (kind === "directory-link") {
      await rename(source, resolve(root, "real"));
      await symlink(resolve(root, "real"), source, "dir");
    }
    if (kind === "file-link") {
      await rm(resolve(source, "file-sync-darwin.node"));
      await symlink(
        resolve(output, "native/file-sync-darwin.node"),
        resolve(source, "file-sync-darwin.node"),
      );
    }
    await expect(
      copyNativeFileSyncArtifact(source, output, {
        expectedSourceHash: `sha256:${"a".repeat(64)}`,
      }),
    ).rejects.toThrow();
    expect(await readFile(resolve(output, "native/file-sync-darwin.node"))).toEqual(prior);
  },
);
it("refuses to overwrite foreign destination content", async () => {
  await mkdir(resolve(output, "native"));
  await writeFile(resolve(output, "native/user-owned"), "keep");
  await expect(copyNativeFileSyncArtifact(source, output)).rejects.toThrow("directory_invalid");
  expect(await readFile(resolve(output, "native/user-owned"), "utf8")).toBe("keep");
});
it("rolls back a failed publication before removing staging", async () => {
  await copyNativeFileSyncArtifact(source, output);
  const prior = await readFile(resolve(output, "native/file-sync.json"));
  const actual = await vi.importActual("node:fs/promises");
  vi.mocked(rename)
    .mockImplementationOnce(actual.rename)
    .mockRejectedValueOnce(new Error("publication_failed"));
  await expect(copyNativeFileSyncArtifact(source, output)).rejects.toThrow("publication_failed");
  expect(await readFile(resolve(output, "native/file-sync.json"))).toEqual(prior);
  expect(await readdir(output)).toEqual(["native"]);
});
it("retains the recovery directory when publication and rollback both fail", async () => {
  await copyNativeFileSyncArtifact(source, output);
  const actual = await vi.importActual("node:fs/promises");
  vi.mocked(rename)
    .mockImplementationOnce(actual.rename)
    .mockRejectedValueOnce(new Error("publication_failed"))
    .mockRejectedValueOnce(new Error("rollback_failed"));
  await expect(copyNativeFileSyncArtifact(source, output)).rejects.toThrow(
    "native_file_sync_rollback_failed",
  );
  const entries = await readdir(output);
  expect(entries).toHaveLength(1);
  expect(entries[0]).toBe(".native-copy");
  await expect(copyNativeFileSyncArtifact(source, output)).rejects.toThrow(
    "recovery_or_copy_pending",
  );
  expect(await readdir(output)).toEqual(entries);
  expect(await readFile(resolve(output, entries[0], "prior/file-sync-darwin.node"))).toEqual(
    binary,
  );
});
it.each(["duplicate-cpu", "overlap", "truncated", "wrong-slice", "not-bundle"])(
  "checks actual universal slices: %s",
  (kind) => {
    if (kind === "duplicate-cpu") binary.writeUInt32BE(0x01000007, 28);
    if (kind === "overlap") binary.writeUInt32BE(48, 36);
    if (kind === "truncated") binary = binary.subarray(0, 100);
    if (kind === "wrong-slice") binary.writeUInt32LE(0x01000007, 84);
    if (kind === "not-bundle") binary.writeUInt32LE(2, 60);
    manifest.contentHash = nativeFileSyncDigest(binary);
    expect(() => validateNativeFileSyncArtifact(manifest, binary)).toThrow("binary_invalid");
  },
);
it.each(["Hub", "Node"])(
  "binds native file hashes and dependency edges in the %s SBOM",
  async (kind) => {
    const artifact = await readNativeFileSyncArtifact(source);
    const sbom =
      kind === "Hub"
        ? createHubDistributionSbom("0.1.0", manifest.contentHash, {
            sync: artifact,
            files: artifact.files,
          })
        : createNodeDistributionSbom("0.1.0", ["package@1.0.0"], manifest.contentHash, {
            sync: artifact,
            files: artifact.files,
          });
    expect(() => validateNativeFileSyncSbom(sbom, artifact)).not.toThrow();
    sbom.dependencies[0].dependsOn.shift();
    expect(() => validateNativeFileSyncSbom(sbom, artifact)).toThrow("sbom_invalid");
  },
);
