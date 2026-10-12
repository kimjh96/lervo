import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  nativeAddonArtifactDigest,
  nativeAddonDigest,
  validateNativeAddonArtifact,
} from "./native-addon-contract.mjs";

export async function nativeAddonSourceHash(repositoryRoot, paths) {
  const entries = await Promise.all(
    paths.map(async (path) => [
      path,
      nativeAddonDigest(await readFile(resolve(repositoryRoot, path))),
    ]),
  );
  return nativeAddonDigest(JSON.stringify(entries));
}

async function inspectOwnedDirectory(directory, { names, errorPrefix }) {
  let info;
  try {
    info = await lstat(directory);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error(`${errorPrefix}_directory_invalid`);
  for (const entry of await readdir(directory, { withFileTypes: true }))
    if (!names.includes(entry.name) || !entry.isFile() || entry.isSymbolicLink())
      throw new Error(`${errorPrefix}_directory_invalid`);
  return true;
}

export async function readNativeAddonFiles(directory, contract, { required = false } = {}) {
  const { names, errorPrefix } = contract;
  if (!(await inspectOwnedDirectory(directory, contract))) {
    if (required) throw new Error(`${errorPrefix}_artifact_missing`);
    return undefined;
  }
  const files = {};
  for (const name of names) {
    const path = resolve(directory, name);
    const info = await lstat(path);
    const limit = name.endsWith(".node") ? 1048576 : 4096;
    if (!info.isFile() || info.isSymbolicLink() || info.size > limit)
      throw new Error(`${errorPrefix}_file_invalid`);
    files[name] = await readFile(path);
    if (files[name].length > limit) throw new Error(`${errorPrefix}_file_invalid`);
  }
  return files;
}

export async function readNativeAddonArtifact(directory, contract, options = {}) {
  const files = await readNativeAddonFiles(directory, contract, options);
  if (!files) return undefined;
  const { manifestName, binaryName, errorPrefix } = contract;
  const manifest = validateNativeAddonArtifact(
    JSON.parse(files[manifestName].toString("utf8")),
    files[binaryName],
    options.expectedSourceHash,
    errorPrefix,
  );
  return { manifest, files };
}

/** Replace only the owned pair, preserving the prior directory if staging or publication fails. */
export async function copyNativeAddonArtifact(
  sourceDirectory,
  outputDirectory,
  contract,
  options = {},
) {
  const { names, errorPrefix } = contract;
  const { expectedArtifactDigest, ...readOptions } = options;
  const artifact = await readNativeAddonArtifact(sourceDirectory, contract, readOptions);
  if (
    expectedArtifactDigest !== undefined &&
    (!artifact || nativeAddonArtifactDigest(artifact, names) !== expectedArtifactDigest)
  )
    throw new Error(`${errorPrefix}_digest_mismatch`);
  await publishNativeAddonFiles(artifact?.files, outputDirectory, contract);
  return artifact;
}

/** Publish captured verified buffers as one owned directory; never reopen admitted sources. */
export async function publishNativeAddonFiles(files, outputDirectory, contract) {
  const { names, errorPrefix } = contract;
  const output = await lstat(outputDirectory);
  if (!output.isDirectory() || output.isSymbolicLink())
    throw new Error(`${errorPrefix}_destination_invalid`);
  const destination = resolve(outputDirectory, "native");
  const hadPrior = await inspectOwnedDirectory(destination, contract);
  const staging = resolve(outputDirectory, ".native-copy");
  try {
    await mkdir(staging);
  } catch (error) {
    throw new Error(`${errorPrefix}_recovery_or_copy_pending`, { cause: error });
  }
  const prepared = resolve(staging, "prepared");
  const prior = resolve(staging, "prior");
  let movedPrior = false;
  let retainRecovery = false;
  try {
    if (files) {
      await mkdir(prepared);
      for (const name of names)
        await writeFile(resolve(prepared, name), files[name], { flag: "wx", mode: 0o644 });
    }
    if (hadPrior) {
      await rename(destination, prior);
      movedPrior = true;
    }
    if (files) await rename(prepared, destination);
  } catch (error) {
    if (movedPrior) {
      try {
        await rename(prior, destination);
        movedPrior = false;
      } catch (rollbackError) {
        retainRecovery = true;
        // Retain the prior bytes in staging when rollback fails; never delete the recovery copy.
        throw new AggregateError([error, rollbackError], `${errorPrefix}_rollback_failed`, {
          cause: rollbackError,
        });
      }
    }
    throw error;
  } finally {
    if (!retainRecovery) await rm(staging, { recursive: true, force: true });
  }
}
