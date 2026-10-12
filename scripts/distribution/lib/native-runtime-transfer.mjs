import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { nativeFileSyncSourceHash } from "../../shared/native-file-sync-artifact.mjs";
import { nativeCasSourceHash } from "../../shared/native-cas-artifact.mjs";
import {
  copyNativeRuntimeArtifacts,
  readNativeRuntimeArtifact,
  nativeRuntimeArtifactDigest,
} from "../../shared/native-runtime-artifact.mjs";
import {
  nativeTransferIdentity,
  readNativeTransferReceipt,
  nativeTransferCoordinatesMatch,
} from "./native-transfer-identity.mjs";
import { restoreNativeRuntimePackages } from "./native-runtime-restore.mjs";

export async function createNativeRuntimeTransfer({ repositoryRoot, artifactDirectory }) {
  const syncSourceHash = await nativeFileSyncSourceHash(repositoryRoot);
  const casSourceHash = await nativeCasSourceHash(repositoryRoot);
  const coordinates = nativeTransferIdentity(repositoryRoot);
  await mkdir(artifactDirectory);
  try {
    const artifact = await copyNativeRuntimeArtifacts(
      {
        syncDirectory: resolve(repositoryRoot, "packages/filesystem-durability/dist/native"),
        casDirectory: resolve(repositoryRoot, "packages/cas/dist/native"),
      },
      artifactDirectory,
      { required: true, expectedSyncHash: syncSourceHash, expectedCasHash: casSourceHash },
    );
    const receipt = {
      schemaVersion: 2,
      kind: "lervo_native_runtime_transfer",
      ...coordinates,
      syncSourceHash,
      casSourceHash,
      artifactDigest: nativeRuntimeArtifactDigest(artifact),
    };
    await writeFile(resolve(artifactDirectory, "receipt.json"), JSON.stringify(receipt) + "\n", {
      flag: "wx",
    });
    return receipt;
  } catch (error) {
    await rm(artifactDirectory, { recursive: true, force: true });
    throw error;
  }
}

export async function restoreNativeRuntimeTransfer({ repositoryRoot, artifactDirectory }) {
  const receipt = await readNativeTransferReceipt(artifactDirectory);
  if (
    (await readdir(artifactDirectory)).sort().join(",") !== "native,receipt.json" ||
    !receipt ||
    Object.keys(receipt).sort().join(",") !==
      "artifactDigest,casSourceHash,kind,revision,runAttempt,runId,schemaVersion,syncSourceHash,workflow" ||
    !/^sha256:[a-f0-9]{64}$/u.test(receipt.artifactDigest)
  )
    throw new Error("native_transfer_receipt_invalid");
  if (
    receipt.schemaVersion !== 2 ||
    receipt.kind !== "lervo_native_runtime_transfer" ||
    !nativeTransferCoordinatesMatch(receipt, nativeTransferIdentity(repositoryRoot)) ||
    receipt.syncSourceHash !== (await nativeFileSyncSourceHash(repositoryRoot)) ||
    receipt.casSourceHash !== (await nativeCasSourceHash(repositoryRoot))
  )
    throw new Error("native_transfer_identity_mismatch");
  const artifact = await readNativeRuntimeArtifact(resolve(artifactDirectory, "native"), {
    required: true,
    casRequired: true,
    expectedSyncHash: receipt.syncSourceHash,
    expectedCasHash: receipt.casSourceHash,
  });
  if (nativeRuntimeArtifactDigest(artifact) !== receipt.artifactDigest)
    throw new Error("native_transfer_digest_mismatch");
  await restoreNativeRuntimePackages(repositoryRoot, artifact);
  return receipt;
}
