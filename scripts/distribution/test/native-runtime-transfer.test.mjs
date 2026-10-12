import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("node:child_process", async (original) => ({
  ...(await original()),
  execFileSync: vi.fn(() => "a".repeat(40)),
}));
vi.mock("node:fs/promises", async (original) => {
  const fs = await original();
  return { ...fs, rename: vi.fn(fs.rename), mkdir: vi.fn(fs.mkdir) };
});
import { nativeFileSyncFixture } from "./native-file-sync-fixture.mjs";
import {
  nativeFileSyncSourceHash,
  readNativeFileSyncArtifact,
} from "../../shared/native-file-sync-artifact.mjs";
import { nativeCasSourceHash, readNativeCasArtifact } from "../../shared/native-cas-artifact.mjs";
import { nativeAddonDigest } from "../../shared/native-addon-contract.mjs";
import {
  createNativeRuntimeTransfer,
  restoreNativeRuntimeTransfer,
} from "../lib/native-runtime-transfer.mjs";

let root, input, outputs, prior, receipt;
beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), "lervo-runtime-transfer-"));
  input = {
    repositoryRoot: resolve(root, "repository"),
    artifactDirectory: resolve(root, "transfer"),
  };
  vi.mocked(execFileSync).mockReturnValue("a".repeat(40));
  vi.stubEnv("GITHUB_WORKFLOW", "fixture");
  vi.stubEnv("GITHUB_RUN_ID", "42");
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "1");
  const sources = [
    ...["binding.c", "cas-io.c", "cas-io.h"].map((name) => "packages/cas/native/" + name),
    ...["build-native.mjs", "build-native-artifact.mjs"].map(
      (name) => "packages/cas/scripts/" + name,
    ),
    ...["binding.c", "sync-group.c", "sync-group.h"].map(
      (name) => "packages/filesystem-durability/native/" + name,
    ),
    "packages/filesystem-durability/scripts/build-native.mjs",
    ...[
      "native-cas-artifact",
      "native-cas-contract",
      "native-file-sync-artifact",
      "native-file-sync-contract",
      "native-addon-artifact",
      "native-addon-contract",
      "native-runtime-artifact",
      "native-runtime-contract",
    ].map((name) => "scripts/shared/" + name + ".mjs"),
  ];
  for (const path of sources) {
    const target = resolve(input.repositoryRoot, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(import.meta.dirname, "../../..", path), target);
  }
  outputs = [
    {
      root: resolve(input.repositoryRoot, "packages/filesystem-durability/dist/native"),
      name: "file-sync",
      hash: await nativeFileSyncSourceHash(input.repositoryRoot),
      read: readNativeFileSyncArtifact,
    },
    {
      root: resolve(input.repositoryRoot, "packages/cas/dist/native"),
      name: "cas-io",
      hash: await nativeCasSourceHash(input.repositoryRoot),
      read: readNativeCasArtifact,
    },
  ];
  for (const output of outputs) {
    await mkdir(output.root, { recursive: true });
    await persist(output, 2);
  }
  receipt = await createNativeRuntimeTransfer(input);
  for (const output of outputs) await persist(output, 3);
  prior = await Promise.all(outputs.map((output) => output.read(output.root)));
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.mocked(rename).mockReset();
  vi.mocked(mkdir).mockReset();
  const fs = await vi.importActual("node:fs/promises");
  vi.mocked(rename).mockImplementation(fs.rename);
  vi.mocked(mkdir).mockImplementation(fs.mkdir);
  await rm(root, { recursive: true, force: true });
});
async function persist(output, marker) {
  const { binary, manifest } = nativeFileSyncFixture();
  binary[111] = marker;
  manifest.sourceHash = output.hash;
  manifest.contentHash = nativeAddonDigest(binary);
  await writeFile(resolve(output.root, output.name + "-darwin.node"), binary);
  await writeFile(resolve(output.root, output.name + ".json"), JSON.stringify(manifest));
}
async function unchanged() {
  expect(await Promise.all(outputs.map((output) => output.read(output.root)))).toEqual(prior);
}

it("restores both exact pairs from the same workflow and accepts a preceding producer attempt", async () => {
  vi.stubEnv("GITHUB_RUN_ATTEMPT", "2");
  expect(await restoreNativeRuntimeTransfer(input)).toEqual(receipt);
  for (const output of outputs) {
    const artifact = await output.read(output.root, { expectedSourceHash: output.hash });
    expect(artifact.files[output.name + "-darwin.node"][111]).toBe(2);
  }
});
it.each([
  "revision",
  "workflow",
  "runId",
  "runAttempt",
  "syncSourceHash",
  "casSourceHash",
  "schemaVersion",
  "extra",
  "manifest-bytes",
  "binary-bytes",
  "partial",
])("rejects changed %s before replacing either package", async (kind) => {
  if (kind === "manifest-bytes")
    await writeFile(
      resolve(input.artifactDirectory, "native/cas-io.json"),
      JSON.stringify(
        JSON.parse(await readFile(resolve(input.artifactDirectory, "native/cas-io.json"), "utf8")),
        null,
        2,
      ),
    );
  else if (kind === "binary-bytes") {
    const directory = resolve(input.artifactDirectory, "native");
    const binary = await readFile(resolve(directory, "cas-io-darwin.node"));
    binary[111]++;
    const manifest = JSON.parse(await readFile(resolve(directory, "cas-io.json"), "utf8"));
    manifest.contentHash = nativeAddonDigest(binary);
    await writeFile(resolve(directory, "cas-io-darwin.node"), binary);
    await writeFile(resolve(directory, "cas-io.json"), JSON.stringify(manifest));
  } else if (kind === "partial") await rm(resolve(input.artifactDirectory, "native/cas-io.json"));
  else {
    const changed = { ...receipt, [kind]: kind === "schemaVersion" ? 1 : "changed" };
    await writeFile(resolve(input.artifactDirectory, "receipt.json"), JSON.stringify(changed));
  }
  await expect(restoreNativeRuntimeTransfer(input)).rejects.toThrow();
  await unchanged();
});
it.each([false, true])(
  "restores both predecessors or retains recovery after second publication failure, rollback failure %s",
  async (failRollback) => {
    const fs = await vi.importActual("node:fs/promises");
    vi.mocked(rename).mockImplementation(async (source, target) => {
      if (
        String(source).endsWith("/cas-prepared") ||
        (failRollback && String(source).endsWith("/sync-prior"))
      )
        throw Error("injected rename failure");
      return fs.rename(source, target);
    });
    await expect(restoreNativeRuntimeTransfer(input)).rejects.toThrow(
      failRollback ? "rollback_failed" : "injected rename failure",
    );
    if (!failRollback) await unchanged();
    else {
      const stage = resolve(input.repositoryRoot, "packages/cas/dist/.native-runtime-transfer");
      expect(await readNativeFileSyncArtifact(resolve(stage, "sync-prior"))).toEqual(prior[0]);
      expect(await outputs[1].read(outputs[1].root)).toEqual(prior[1]);
      await expect(restoreNativeRuntimeTransfer(input)).rejects.toThrow("recovery_or_copy_pending");
    }
  },
);
it("publishes captured bytes when the transfer source changes after admission", async () => {
  const fs = await vi.importActual("node:fs/promises");
  vi.mocked(mkdir).mockImplementation(async (path, options) => {
    if (String(path).endsWith("/.native-runtime-transfer"))
      await writeFile(
        resolve(input.artifactDirectory, "native/cas-io-darwin.node"),
        "changed after admission",
      );
    return fs.mkdir(path, options);
  });
  await restoreNativeRuntimeTransfer(input);
  expect((await readNativeCasArtifact(outputs[1].root)).files["cas-io-darwin.node"][111]).toBe(2);
});
it("preserves foreign output and refuses retained copy recovery before publication", async () => {
  await writeFile(resolve(outputs[1].root, "user-owned"), "keep");
  await expect(restoreNativeRuntimeTransfer(input)).rejects.toThrow("directory_invalid");
  expect(await readFile(resolve(outputs[1].root, "user-owned"), "utf8")).toBe("keep");
  expect(await outputs[0].read(outputs[0].root)).toEqual(prior[0]);
  await rm(resolve(outputs[1].root, "user-owned"));
  await mkdir(resolve(outputs[1].root, "../.native-copy"));
  await expect(restoreNativeRuntimeTransfer(input)).rejects.toThrow("recovery_or_copy_pending");
  await unchanged();
});
