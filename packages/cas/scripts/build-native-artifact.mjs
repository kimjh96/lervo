import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { nativeCasDigest } from "../../../scripts/shared/native-cas-contract.mjs";
import {
  copyNativeCasArtifact,
  nativeCasSourceHash,
  readNativeCasArtifact,
} from "../../../scripts/shared/native-cas-artifact.mjs";

export async function buildNativeCasArtifact({
  repositoryRoot,
  platform = process.platform,
  run = promisify(execFile),
}) {
  const root = resolve(repositoryRoot, "packages/cas"),
    output = resolve(root, "dist");
  const stage = resolve(output, ".cas-native-build");
  try {
    await lstat(stage);
    throw new Error("native_cas_build_or_recovery_pending");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const sourceHash = await nativeCasSourceHash(repositoryRoot);
  const existing = await readNativeCasArtifact(resolve(output, "native"));
  if (existing?.manifest.sourceHash === sourceHash) return existing;
  if (platform !== "darwin") {
    if (existing) throw new Error("native_cas_source_changed");
    return undefined;
  }
  await mkdir(output, { recursive: true });
  await mkdir(stage);
  try {
    const prepared = resolve(stage, "native");
    await mkdir(prepared);
    const binary = resolve(prepared, "cas-io-darwin.node");
    const headers = resolve(dirname(await realpath(process.execPath)), "../include/node");
    await run("xcrun", [
      "clang",
      "-std=c11",
      "-O2",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-DNAPI_VERSION=8",
      "-mmacosx-version-min=11.0",
      "-arch",
      "arm64",
      "-arch",
      "x86_64",
      "-bundle",
      "-undefined",
      "dynamic_lookup",
      "-I",
      headers,
      resolve(root, "native/binding.c"),
      resolve(root, "native/cas-io.c"),
      "-o",
      binary,
    ]);
    await writeFile(
      resolve(prepared, "cas-io.json"),
      JSON.stringify(
        {
          schemaVersion: 1,
          apiVersion: 1,
          napiVersion: 8,
          platform: "darwin",
          architectures: ["arm64", "x64"],
          sourceHash,
          contentHash: nativeCasDigest(await readFile(binary)),
        },
        null,
        2,
      ) + "\n",
      { flag: "wx" },
    );
    if (sourceHash !== (await nativeCasSourceHash(repositoryRoot)))
      throw new Error("native_cas_source_changed");
    return await copyNativeCasArtifact(prepared, output, {
      required: true,
      expectedSourceHash: sourceHash,
    });
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
