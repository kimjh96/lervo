import {
  nativeTransferIdentity as identity,
  readNativeTransferReceipt,
  nativeTransferCoordinatesMatch,
} from "./native-transfer-identity.mjs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  copyNativeFileSyncArtifact,
  nativeFileSyncSourceHash,
} from "../../shared/native-file-sync-artifact.mjs";
import { nativeFileSyncArtifactDigest } from "../../shared/native-file-sync-contract.mjs";

export async function createNativeFileSyncTransfer({ repositoryRoot, artifactDirectory }) {
  const sourceHash = await nativeFileSyncSourceHash(repositoryRoot);
  const coordinates = identity(repositoryRoot);
  await mkdir(artifactDirectory);
  try {
    const artifact = await copyNativeFileSyncArtifact(
      resolve(repositoryRoot, "packages/filesystem-durability/dist/native"),
      artifactDirectory,
      { required: true, expectedSourceHash: sourceHash },
    );
    const receipt = {
      schemaVersion: 1,
      kind: "lervo_native_file_sync_transfer",
      ...coordinates,
      sourceHash,
      artifactDigest: nativeFileSyncArtifactDigest(artifact),
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

export async function restoreNativeFileSyncTransfer({ repositoryRoot, artifactDirectory }) {
  const receipt = await readNativeTransferReceipt(artifactDirectory);
  if (
    !receipt ||
    Object.keys(receipt).sort().join(",") !==
      "artifactDigest,kind,revision,runAttempt,runId,schemaVersion,sourceHash,workflow" ||
    typeof receipt.runAttempt !== "string" ||
    typeof receipt.artifactDigest !== "string" ||
    !/^sha256:[a-f0-9]{64}$/u.test(receipt.artifactDigest)
  )
    throw new Error("native_transfer_receipt_invalid");
  const expected = identity(repositoryRoot);
  if (
    receipt.schemaVersion !== 1 ||
    receipt.kind !== "lervo_native_file_sync_transfer" ||
    !nativeTransferCoordinatesMatch(receipt, expected) ||
    receipt.sourceHash !== (await nativeFileSyncSourceHash(repositoryRoot))
  )
    throw new Error("native_transfer_identity_mismatch");
  const source = resolve(artifactDirectory, "native");
  const output = resolve(repositoryRoot, "packages/filesystem-durability/dist");
  await mkdir(output, { recursive: true });
  try {
    // The copy validates the private bytes it will publish, without reopening admitted files.
    await copyNativeFileSyncArtifact(source, output, {
      required: true,
      expectedSourceHash: receipt.sourceHash,
      expectedArtifactDigest: receipt.artifactDigest,
    });
  } catch (error) {
    if (error?.message === "native_file_sync_digest_mismatch")
      throw new Error("native_transfer_digest_mismatch", { cause: error });
    throw error;
  }
  return receipt;
}
