import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
vi.mock("node:fs/promises", async (original) => {
  const fs = await original();
  return { ...fs, rename: vi.fn(fs.rename), mkdir: vi.fn(fs.mkdir) };
});
import {
  copyNativeRuntimeArtifacts,
  nativeRuntimeArtifactDigest,
  nativeRuntimeNames,
  readNativeRuntimeArtifact,
} from "../../shared/native-runtime-artifact.mjs";
import { copyNativeFileSyncArtifact } from "../../shared/native-file-sync-artifact.mjs";
import { copyNativeCasArtifact } from "../../shared/native-cas-artifact.mjs";
import { nativeFileSyncFixture } from "./native-file-sync-fixture.mjs";

const roots = [];
afterEach(async () => {
  vi.mocked(rename).mockReset();
  vi.mocked(rename).mockImplementation((await vi.importActual("node:fs/promises")).rename);
  vi.mocked(mkdir).mockReset();
  vi.mocked(mkdir).mockImplementation((await vi.importActual("node:fs/promises")).mkdir);
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-native-runtime-assets-"));
  roots.push(root);
  const syncDirectory = resolve(root, "sync"),
    casDirectory = resolve(root, "cas"),
    output = resolve(root, "output");
  await Promise.all([syncDirectory, casDirectory, output].map((path) => mkdir(path)));
  const { binary, manifest } = nativeFileSyncFixture();
  for (const [directory, name] of [
    [syncDirectory, "file-sync"],
    [casDirectory, "cas-io"],
  ]) {
    await writeFile(resolve(directory, name + "-darwin.node"), binary);
    await writeFile(resolve(directory, name + ".json"), JSON.stringify(manifest));
  }
  return { root, syncDirectory, casDirectory, output, manifest };
}

it("upgrades a legacy pair to one complete captured four-file set", async () => {
  const f = await fixture();
  await copyNativeFileSyncArtifact(f.syncDirectory, f.output);
  expect((await readNativeRuntimeArtifact(resolve(f.output, "native"))).cas).toBeUndefined();
  await expect(
    readNativeRuntimeArtifact(resolve(f.output, "native"), { casRequired: true }),
  ).rejects.toThrow("cas_missing");
  const artifact = await copyNativeRuntimeArtifacts(f, f.output, {
    required: true,
    expectedSyncHash: f.manifest.sourceHash,
    expectedCasHash: f.manifest.sourceHash,
  });
  expect(await readdir(resolve(f.output, "native"))).toEqual(nativeRuntimeNames);
  expect(
    await readNativeRuntimeArtifact(resolve(f.output, "native"), { casRequired: true }),
  ).toEqual(artifact);
  await expect(copyNativeFileSyncArtifact(f.syncDirectory, f.output)).rejects.toThrow(
    "directory_invalid",
  );
  await expect(copyNativeCasArtifact(f.casDirectory, f.output)).rejects.toThrow(
    "directory_invalid",
  );
});

it.each(["missing-cas", "partial-cas", "invalid-cas", "changed-digest", "foreign-destination"])(
  "rejects %s before replacing the prior complete set",
  async (kind) => {
    const f = await fixture(),
      prior = await copyNativeRuntimeArtifacts(f, f.output);
    if (kind === "missing-cas") await rm(f.casDirectory, { recursive: true });
    if (kind === "partial-cas") await rm(resolve(f.casDirectory, "cas-io.json"));
    if (kind === "invalid-cas")
      await writeFile(resolve(f.casDirectory, "cas-io-darwin.node"), "changed");
    if (kind === "foreign-destination")
      await writeFile(resolve(f.output, "native", "user-owned"), "keep");
    await expect(
      copyNativeRuntimeArtifacts(
        f,
        f.output,
        kind === "changed-digest"
          ? { expectedArtifactDigest: `sha256:${"f".repeat(64)}` }
          : { required: true },
      ),
    ).rejects.toThrow();
    for (const name of nativeRuntimeNames)
      expect(await readFile(resolve(f.output, "native", name))).toEqual(prior.files[name]);
    if (kind === "foreign-destination")
      expect(await readFile(resolve(f.output, "native", "user-owned"), "utf8")).toBe("keep");
  },
);

it.each([false, true])(
  "restores or retains the complete prior set after publication failure, rollback failure %s",
  async (failRollback) => {
    const f = await fixture(),
      prior = await copyNativeRuntimeArtifacts(f, f.output);
    vi.mocked(rename)
      .mockImplementationOnce((await vi.importActual("node:fs/promises")).rename)
      .mockRejectedValueOnce(new Error("publication failed"));
    if (failRollback) vi.mocked(rename).mockRejectedValueOnce(new Error("rollback failed"));
    await expect(copyNativeRuntimeArtifacts(f, f.output)).rejects.toThrow(
      failRollback ? "rollback_failed" : "publication failed",
    );
    const directory = resolve(f.output, failRollback ? ".native-copy/prior" : "native");
    expect(await readNativeRuntimeArtifact(directory)).toEqual(prior);
    if (failRollback)
      await expect(copyNativeRuntimeArtifacts(f, f.output)).rejects.toThrow(
        "recovery_or_copy_pending",
      );
  },
);

it("publishes captured buffers if source files change after admission", async () => {
  const f = await fixture(),
    prior = await copyNativeRuntimeArtifacts(f, f.output),
    digest = nativeRuntimeArtifactDigest(prior);
  const actual = await vi.importActual("node:fs/promises");
  vi.mocked(mkdir).mockImplementation(async (path, options) => {
    if (path === resolve(f.output, ".native-copy"))
      await writeFile(resolve(f.casDirectory, "cas-io-darwin.node"), "changed after admission");
    return actual.mkdir(path, options);
  });
  expect(await copyNativeRuntimeArtifacts(f, f.output, { expectedArtifactDigest: digest })).toEqual(
    prior,
  );
  expect(await readNativeRuntimeArtifact(resolve(f.output, "native"))).toEqual(prior);
});
