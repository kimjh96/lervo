import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { buildNativeCasArtifact } from "../../../packages/cas/scripts/build-native-artifact.mjs";
import { nativeCasSourceHash, readNativeCasArtifact } from "../../shared/native-cas-artifact.mjs";
import { nativeFileSyncFixture } from "./native-file-sync-fixture.mjs";

const roots = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-cas-native-build-"));
  roots.push(root);
  for (const path of [
    "packages/cas/native/binding.c",
    "packages/cas/native/cas-io.c",
    "packages/cas/native/cas-io.h",
    "packages/cas/scripts/build-native.mjs",
    "packages/cas/scripts/build-native-artifact.mjs",
    "scripts/shared/native-cas-contract.mjs",
    "scripts/shared/native-cas-artifact.mjs",
    "scripts/shared/native-addon-contract.mjs",
    "scripts/shared/native-addon-artifact.mjs",
    "scripts/shared/native-runtime-artifact.mjs",
    "scripts/shared/native-runtime-contract.mjs",
  ]) {
    const target = resolve(root, path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(resolve(import.meta.dirname, "../../..", path), target);
  }
  const run = vi.fn(async (_command, args) => {
    await writeFile(args.at(-1), nativeFileSyncFixture().binary);
  });
  return {
    root,
    run,
    output: resolve(root, "packages/cas/dist"),
    input: { repositoryRoot: root, platform: "darwin", run },
  };
}

it("builds a source-bound universal pair and reuses only matching bytes", async () => {
  const { root, run, output, input } = await fixture();
  const first = await buildNativeCasArtifact(input);
  expect(first.manifest.sourceHash).toBe(await nativeCasSourceHash(root));
  expect(await readdir(output)).toEqual(["native"]);
  expect(await buildNativeCasArtifact(input)).toEqual(first);
  expect(run).toHaveBeenCalledTimes(1);
  expect(run.mock.calls[0][1]).toEqual(
    expect.arrayContaining(["-DNAPI_VERSION=8", "arm64", "x86_64", "-Werror"]),
  );
  await writeFile(resolve(root, "packages/cas/native/cas-io.h"), "changed source");
  const changed = await buildNativeCasArtifact(input);
  expect(changed.manifest.sourceHash).not.toBe(first.manifest.sourceHash);
  expect(run).toHaveBeenCalledTimes(2);
});

it.each(["compiler", "source-drift", "invalid-binary"])(
  "preserves the prior artifact on %s failure",
  async (kind) => {
    const { root, output, input } = await fixture();
    await buildNativeCasArtifact(input);
    const before = await readNativeCasArtifact(resolve(output, "native"));
    await writeFile(resolve(root, "packages/cas/native/cas-io.h"), "changed source");
    const run = async (_command, args) => {
      if (kind === "compiler") throw new Error("compiler failed");
      await writeFile(
        args.at(-1),
        kind === "invalid-binary" ? Buffer.from("not Mach-O") : nativeFileSyncFixture().binary,
      );
      if (kind === "source-drift")
        await writeFile(resolve(root, "packages/cas/native/cas-io.h"), "changed during compile");
    };
    await expect(buildNativeCasArtifact({ ...input, run })).rejects.toThrow();
    expect(await readNativeCasArtifact(resolve(output, "native"))).toEqual(before);
    expect(await readdir(output)).toEqual(["native"]);
  },
);

it("retains foreign output and blocks an interrupted build without clearing it", async () => {
  const { output, input } = await fixture();
  await mkdir(resolve(output, "native"), { recursive: true });
  await writeFile(resolve(output, "native", "user-owned"), "keep");
  await expect(buildNativeCasArtifact(input)).rejects.toThrow("directory_invalid");
  expect(await readFile(resolve(output, "native", "user-owned"), "utf8")).toBe("keep");
  await rm(resolve(output, "native"), { recursive: true });
  await mkdir(resolve(output, ".cas-native-build"));
  await writeFile(resolve(output, ".cas-native-build", "retained"), "recovery");
  await expect(buildNativeCasArtifact(input)).rejects.toThrow("build_or_recovery_pending");
  expect(await readFile(resolve(output, ".cas-native-build", "retained"), "utf8")).toBe("recovery");
});

it("keeps unsupported builders ordinary but rejects a stale transferred pair", async () => {
  const { root, run, input } = await fixture();
  expect(await buildNativeCasArtifact({ ...input, platform: "linux" })).toBeUndefined();
  expect(run).not.toHaveBeenCalled();
  const artifact = await buildNativeCasArtifact(input);
  expect(await buildNativeCasArtifact({ ...input, platform: "linux" })).toEqual(artifact);
  await writeFile(resolve(root, "packages/cas/native/cas-io.h"), "drift");
  await expect(buildNativeCasArtifact({ ...input, platform: "linux" })).rejects.toThrow(
    "source_changed",
  );
  expect(run).toHaveBeenCalledTimes(1);
});

it("blocks a retained transfer stage even when the compiled pair matches current sources", async () => {
  const { output, input } = await fixture();
  await buildNativeCasArtifact(input);
  await mkdir(resolve(output, ".native-runtime-transfer"));
  await expect(buildNativeCasArtifact(input)).rejects.toThrow("build_or_recovery_pending");
});
