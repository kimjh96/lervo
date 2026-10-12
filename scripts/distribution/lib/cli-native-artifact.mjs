import { resolve } from "node:path";
import { nativeFileSyncSourceHash } from "../../shared/native-file-sync-artifact.mjs";
import {
  readNativeRuntimeArtifact,
  nativeRuntimeNames,
} from "../../shared/native-runtime-artifact.mjs";
import { nativeCasSourceHash } from "../../shared/native-cas-artifact.mjs";
import { smokeNativeCas } from "../../shared/native-cas-smoke.mjs";
import { smokeNativeFileSync } from "../../shared/native-file-sync-smoke.mjs";
import { repositoryRoot } from "./installed-cli.mjs";

/** Compare installed bytes with the exact source-bound build before a native consumer smoke. */
export async function verifyCliNativeArtifact(packageRoot, { smoke = false } = {}) {
  const expected = await readNativeRuntimeArtifact(
    resolve(repositoryRoot, "apps/cli/dist/native"),
    {
      required: true,
      casRequired: true,
      expectedSyncHash: await nativeFileSyncSourceHash(repositoryRoot),
      expectedCasHash: await nativeCasSourceHash(repositoryRoot),
    },
  );
  const directory = resolve(packageRoot, "dist/native");
  const actual = await readNativeRuntimeArtifact(directory, {
    required: true,
    casRequired: true,
    expectedSyncHash: expected.sync.manifest.sourceHash,
    expectedCasHash: expected.cas.manifest.sourceHash,
  });
  if (nativeRuntimeNames.some((name) => !actual.files[name].equals(expected.files[name])))
    throw new Error("release_native_consumer_changed");
  if (smoke && process.platform === "darwin") {
    const sync = await smokeNativeFileSync(directory);
    await smokeNativeCas(directory);
    return sync;
  }
  return "verified";
}
