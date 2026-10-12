import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import { nativeFileSyncDigest as digest } from "../../../scripts/shared/native-file-sync-contract.mjs";
import {
  nativeFileSyncSourceHash,
  readNativeFileSyncArtifact,
} from "../../../scripts/shared/native-file-sync-artifact.mjs";

// Compilation belongs to builds; runtime never invokes a compiler or downloads code.
const root = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(root, "../..");
const sourceHash = await nativeFileSyncSourceHash(repositoryRoot);
const output = resolve(root, "dist/native");
let existing;
try {
  const entry = await lstat(output);
  if (!entry.isDirectory() || entry.isSymbolicLink())
    throw new Error("native_file_sync_directory_invalid");
  if ((await readdir(output)).length) existing = await readNativeFileSyncArtifact(output);
} catch (error) {
  if (error.code !== "ENOENT") throw error;
  // Only an absent build directory is fresh; an incomplete declared artifact must fail.
  if (
    await lstat(output).then(
      () => true,
      () => false,
    )
  )
    throw error;
}
if (process.platform === "darwin" && existing?.manifest.sourceHash !== sourceHash) {
  const run = promisify(execFile);
  await mkdir(output, { recursive: true });
  const staging = resolve(output, ".native-build");
  await mkdir(staging);
  const binary = resolve(staging, "file-sync-darwin.node");
  try {
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
      resolve(root, "native/sync-group.c"),
      "-o",
      binary,
    ]);
    await writeFile(
      resolve(staging, "file-sync.json"),
      `${JSON.stringify(
        {
          schemaVersion: 1,
          apiVersion: 1,
          napiVersion: 8,
          platform: "darwin",
          architectures: ["arm64", "x64"],
          sourceHash,
          contentHash: digest(await readFile(binary)),
        },
        null,
        2,
      )}\n`,
    );
    if (sourceHash !== (await nativeFileSyncSourceHash(repositoryRoot)))
      throw new Error("native_file_sync_source_changed");
    await rename(binary, resolve(output, "file-sync-darwin.node"));
    await rename(resolve(staging, "file-sync.json"), resolve(output, "file-sync.json"));
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
} else if (existing && existing.manifest.sourceHash !== sourceHash) {
  throw new Error("native_file_sync_source_changed");
}
