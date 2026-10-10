import { resolve } from "node:path";
import {
  readNativeFileSyncArtifact,
  nativeFileSyncSourceHash,
} from "../../shared/native-file-sync-artifact.mjs";
import { nativeFileSyncNames } from "../../shared/native-file-sync-contract.mjs";
import { smokeNativeFileSync } from "../../shared/native-file-sync-smoke.mjs";
import { repositoryRoot } from "./installed-cli.mjs";

/** Compare installed bytes with the exact source-bound build before a native consumer smoke. */
export async function verifyCliNativeArtifact(packageRoot, { smoke = false } = {}) {
  const expected = await readNativeFileSyncArtifact(
    resolve(repositoryRoot, "apps/cli/dist/native"),
    {
      required: true,
      expectedSourceHash: await nativeFileSyncSourceHash(repositoryRoot),
    },
  );
  const directory = resolve(packageRoot, "dist/native");
  const actual = await readNativeFileSyncArtifact(directory, {
    required: true,
    expectedSourceHash: expected.manifest.sourceHash,
  });
  if (nativeFileSyncNames.some((name) => !actual.files[name].equals(expected.files[name])))
    throw new Error("release_native_consumer_changed");
  if (smoke && process.platform === "darwin") return smokeNativeFileSync(directory);
  return "verified";
}
