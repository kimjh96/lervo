import { resolve } from "node:path";
import { lstat, readdir } from "node:fs/promises";
import { nativeAddonArtifactDigest } from "./native-addon-contract.mjs";
import { publishNativeAddonFiles, readNativeAddonFiles } from "./native-addon-artifact.mjs";
import {
  nativeFileSyncNames,
  validateNativeFileSyncArtifact,
} from "./native-file-sync-contract.mjs";
import { nativeCasNames, validateNativeCasArtifact } from "./native-cas-contract.mjs";
import { readNativeFileSyncArtifact } from "./native-file-sync-artifact.mjs";
import { readNativeCasArtifact } from "./native-cas-artifact.mjs";
import { nativeRuntimeNames } from "./native-runtime-contract.mjs";

export { nativeRuntimeNames } from "./native-runtime-contract.mjs";
const contract = { names: nativeRuntimeNames, errorPrefix: "native_runtime" };
export const nativeRuntimeArtifactDigest = (artifact) =>
  nativeAddonArtifactDigest(artifact, Object.keys(artifact.files).sort());

/** Legacy two-file assets remain readable; new writers publish both pairs together. */
export async function readNativeRuntimeArtifact(
  directory,
  { required = false, casRequired = false, expectedSyncHash, expectedCasHash } = {},
) {
  let names;
  try {
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink())
      throw new Error("native_runtime_directory_invalid");
    names = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT" && !required && !casRequired) return undefined;
    throw error;
  }
  const hasCas = nativeCasNames.some((name) => names.includes(name));
  if (casRequired && !hasCas) throw new Error("native_runtime_cas_missing");
  const files = await readNativeAddonFiles(
    directory,
    { ...contract, names: hasCas ? nativeRuntimeNames : nativeFileSyncNames },
    { required: true },
  );
  const sync = {
    manifest: validateNativeFileSyncArtifact(
      JSON.parse(files["file-sync.json"]),
      files["file-sync-darwin.node"],
      expectedSyncHash,
    ),
    files: Object.fromEntries(nativeFileSyncNames.map((name) => [name, files[name]])),
  };
  const cas = hasCas
    ? {
        manifest: validateNativeCasArtifact(
          JSON.parse(files["cas-io.json"]),
          files["cas-io-darwin.node"],
          expectedCasHash,
        ),
        files: Object.fromEntries(nativeCasNames.map((name) => [name, files[name]])),
      }
    : undefined;
  return { sync, cas, files };
}

/** Copy an admitted aggregate without reopening its source after digest verification. */
export async function copyNativeRuntimeArtifact(sourceDirectory, outputDirectory, options = {}) {
  const { expectedArtifactDigest, ...readOptions } = options;
  const artifact = await readNativeRuntimeArtifact(sourceDirectory, readOptions);
  if (
    expectedArtifactDigest !== undefined &&
    (!artifact || nativeRuntimeArtifactDigest(artifact) !== expectedArtifactDigest)
  )
    throw new Error("native_runtime_digest_mismatch");
  await publishNativeAddonFiles(artifact?.files, outputDirectory, {
    ...contract,
    names: artifact ? Object.keys(artifact.files).sort() : nativeRuntimeNames,
  });
  return artifact;
}

export async function copyNativeRuntimeArtifacts(
  { syncDirectory, casDirectory },
  outputDirectory,
  { required = false, expectedSyncHash, expectedCasHash, expectedArtifactDigest } = {},
) {
  try {
    await lstat(resolve(casDirectory, "../.native-runtime-transfer"));
    throw new Error("native_runtime_recovery_or_copy_pending");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const sync = await readNativeFileSyncArtifact(syncDirectory, {
    required,
    expectedSourceHash: expectedSyncHash,
  });
  const cas = await readNativeCasArtifact(casDirectory, {
    required,
    expectedSourceHash: expectedCasHash,
  });
  if (Boolean(sync) !== Boolean(cas)) throw new Error("native_runtime_artifact_incomplete");
  const artifact = sync ? { sync, cas, files: { ...sync.files, ...cas.files } } : undefined;
  if (
    expectedArtifactDigest !== undefined &&
    (!artifact || nativeRuntimeArtifactDigest(artifact) !== expectedArtifactDigest)
  )
    throw new Error("native_runtime_digest_mismatch");
  await publishNativeAddonFiles(artifact?.files, outputDirectory, contract);
  return artifact;
}
