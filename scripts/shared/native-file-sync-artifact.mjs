import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  nativeFileSyncDigest,
  nativeFileSyncNames,
  validateNativeFileSyncArtifact,
} from "./native-file-sync-contract.mjs";

export async function nativeFileSyncSourceHash(repositoryRoot) {
  const paths = [
    "packages/filesystem-durability/native/binding.c",
    "packages/filesystem-durability/native/sync-group.c",
    "packages/filesystem-durability/native/sync-group.h",
    "packages/filesystem-durability/scripts/build-native.mjs",
    "scripts/shared/native-file-sync-contract.mjs",
    "scripts/shared/native-file-sync-artifact.mjs",
  ];
  const entries = await Promise.all(
    paths.map(async (path) => [
      path,
      nativeFileSyncDigest(await readFile(resolve(repositoryRoot, path))),
    ]),
  );
  return nativeFileSyncDigest(JSON.stringify(entries));
}

async function inspectOwnedDirectory(directory) {
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("native_file_sync_directory_invalid");
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (!nativeFileSyncNames.includes(entry.name) || !entry.isFile() || entry.isSymbolicLink())
      throw new Error("native_file_sync_directory_invalid");
  return true;
}

export async function readNativeFileSyncArtifact(
  directory,
  { required = false, expectedSourceHash } = {},
) {
  if (!(await inspectOwnedDirectory(directory))) {
    if (required) throw new Error("native_file_sync_artifact_missing");
    return undefined;
  }
  const files = {};
  for (const name of nativeFileSyncNames) {
    const path = resolve(directory, name);
    const info = await lstat(path);
    const limit = name.endsWith(".node") ? 1048576 : 4096;
    if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
      throw new Error("native_file_sync_file_invalid");
    files[name] = await readFile(path);
    if (files[name].length > limit) throw new Error("native_file_sync_file_invalid");
  }
  const manifest = validateNativeFileSyncArtifact(
    JSON.parse(files["file-sync.json"].toString("utf8")),
    files["file-sync-darwin.node"],
    expectedSourceHash,
  );
  return { manifest, files };
}

/** Replace only the owned pair, preserving the prior directory if staging or publication fails. */
export async function copyNativeFileSyncArtifact(sourceDirectory, outputDirectory, options = {}) {
  const artifact = await readNativeFileSyncArtifact(sourceDirectory, options);
  const output = await lstat(outputDirectory);
  if (!output.isDirectory() || output.isSymbolicLink())
    throw new Error("native_file_sync_destination_invalid");
  const destination = resolve(outputDirectory, "native");
  const hadPrior = await inspectOwnedDirectory(destination);
  const staging = resolve(outputDirectory, ".native-copy");
  try {
    await mkdir(staging);
  } catch (error) {
    throw new Error("native_file_sync_recovery_or_copy_pending", { cause: error });
  }
  const prepared = resolve(staging, "prepared");
  const prior = resolve(staging, "prior");
  let movedPrior = false;
  let retainRecovery = false;
  try {
    if (artifact) {
      await mkdir(prepared);
      for (const name of nativeFileSyncNames)
        await writeFile(resolve(prepared, name), artifact.files[name], { flag: "wx", mode: 0o644 });
    }
    if (hadPrior) {
      await rename(destination, prior);
      movedPrior = true;
    }
    if (artifact) await rename(prepared, destination);
  } catch (error) {
    if (movedPrior) {
      try {
        await rename(prior, destination);
        movedPrior = false;
      } catch (rollbackError) {
        retainRecovery = true;
        // Retain the prior bytes in staging when rollback fails; never delete the recovery copy.
        throw new AggregateError([error, rollbackError], "native_file_sync_rollback_failed", {
          cause: rollbackError,
        });
      }
    }
    throw error;
  } finally {
    if (!retainRecovery) await rm(staging, { recursive: true, force: true });
  }
  return artifact;
}
