import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  copyNativeRuntimeArtifacts,
  nativeRuntimeArtifactDigest,
  readNativeRuntimeArtifact,
} from "../../shared/native-runtime-artifact.mjs";
import { restoreNativeRuntimePackages } from "./native-runtime-restore.mjs";
import { nativeRuntimeReuseInputs, nativeRuntimeReuseKey } from "./native-runtime-reuse-key.mjs";
import { nativeTransferIdentity } from "./native-transfer-identity.mjs";

/**
 * A reusable copy of one verified darwin native build, keyed by its inputs (ADR-0590). Unlike the
 * per-run transfer, the receipt binds the build inputs instead of a revision, so another run whose
 * inputs are identical can install the same bytes. Every read recomputes the key from the reading
 * checkout and validates the files against it; nothing in the receipt is trusted on its own.
 */
const RECEIPT_NAME = "reuse.json";
const RECEIPT_KIND = "lervo_native_runtime_reuse";
const RECEIPT_FIELDS = "artifactDigest,inputs,key,kind,producer,schemaVersion";
const RECEIPT_LIMIT = 8192;

const packageDirectories = (repositoryRoot) => ({
  syncDirectory: resolve(repositoryRoot, "packages/filesystem-durability/dist/native"),
  casDirectory: resolve(repositoryRoot, "packages/cas/dist/native"),
});

/** Copies this checkout's built native files into a new reusable artifact directory. */
export async function createNativeRuntimeReuse({
  repositoryRoot,
  artifactDirectory,
  node,
  environment = process.env,
}) {
  const inputs = await nativeRuntimeReuseInputs({ repositoryRoot, node });
  await mkdir(artifactDirectory);
  try {
    const artifact = await copyNativeRuntimeArtifacts(
      packageDirectories(repositoryRoot),
      artifactDirectory,
      {
        required: true,
        expectedSyncHash: inputs.syncSourceHash,
        expectedCasHash: inputs.casSourceHash,
      },
    );
    const receipt = {
      schemaVersion: 1,
      kind: RECEIPT_KIND,
      key: nativeRuntimeReuseKey(inputs),
      inputs,
      artifactDigest: nativeRuntimeArtifactDigest(artifact),
      producer: {
        ...nativeTransferIdentity(repositoryRoot),
        image: environment.ImageOS ? `${environment.ImageOS} ${environment.ImageVersion}` : "local",
      },
    };
    await writeFile(resolve(artifactDirectory, RECEIPT_NAME), `${JSON.stringify(receipt)}\n`, {
      flag: "wx",
    });
    return receipt;
  } catch (error) {
    await rm(artifactDirectory, { recursive: true, force: true });
    throw error;
  }
}

async function readReceipt(artifactDirectory) {
  const directory = await lstat(artifactDirectory);
  if (!directory.isDirectory() || directory.isSymbolicLink())
    throw new Error("native_reuse_directory_invalid");
  if ((await readdir(artifactDirectory)).sort().join(",") !== `native,${RECEIPT_NAME}`)
    throw new Error("native_reuse_receipt_invalid");
  const path = resolve(artifactDirectory, RECEIPT_NAME);
  const file = await lstat(path);
  if (!file.isFile() || file.isSymbolicLink() || file.size > RECEIPT_LIMIT)
    throw new Error("native_reuse_receipt_invalid");
  let receipt;
  try {
    receipt = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error("native_reuse_receipt_invalid", { cause: error });
  }
  if (
    !receipt ||
    typeof receipt !== "object" ||
    Object.keys(receipt).sort().join(",") !== RECEIPT_FIELDS ||
    receipt.schemaVersion !== 1 ||
    receipt.kind !== RECEIPT_KIND ||
    !/^[a-f0-9]{64}$/u.test(receipt.key) ||
    !/^sha256:[a-f0-9]{64}$/u.test(receipt.artifactDigest) ||
    nativeRuntimeReuseKey(receipt.inputs) !== receipt.key
  )
    throw new Error("native_reuse_receipt_invalid");
  return receipt;
}

/**
 * Validates a downloaded artifact for this checkout without installing it. Different build inputs
 * fail with `native_reuse_inputs_mismatch`; changed or substituted files fail the native contract
 * checks or `native_reuse_digest_mismatch`.
 */
export async function verifyNativeRuntimeReuse({ repositoryRoot, artifactDirectory, node }) {
  const receipt = await readReceipt(artifactDirectory);
  const inputs = await nativeRuntimeReuseInputs({ repositoryRoot, node });
  if (nativeRuntimeReuseKey(inputs) !== receipt.key)
    throw new Error("native_reuse_inputs_mismatch");
  const artifact = await readNativeRuntimeArtifact(resolve(artifactDirectory, "native"), {
    required: true,
    casRequired: true,
    expectedSyncHash: inputs.syncSourceHash,
    expectedCasHash: inputs.casSourceHash,
  });
  if (nativeRuntimeArtifactDigest(artifact) !== receipt.artifactDigest)
    throw new Error("native_reuse_digest_mismatch");
  return { receipt, artifact };
}

/** Installs validated bytes into both package outputs, where the build would have written them. */
export async function restoreNativeRuntimeReuse(input) {
  const { receipt, artifact } = await verifyNativeRuntimeReuse(input);
  await restoreNativeRuntimePackages(input.repositoryRoot, artifact);
  return receipt;
}

/** Fails unless a fresh build reproduced the bytes that an earlier artifact offers for reuse. */
export async function compareNativeRuntimeReuse({
  repositoryRoot,
  freshDirectory,
  reusedDirectory,
  node,
}) {
  const fresh = await verifyNativeRuntimeReuse({
    repositoryRoot,
    artifactDirectory: freshDirectory,
    node,
  });
  const reused = await verifyNativeRuntimeReuse({
    repositoryRoot,
    artifactDirectory: reusedDirectory,
    node,
  });
  if (fresh.receipt.artifactDigest !== reused.receipt.artifactDigest)
    throw new Error("native_reuse_not_reproduced");
  return { fresh: fresh.receipt, reused: reused.receipt };
}
