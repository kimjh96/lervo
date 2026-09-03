import { lstat, readFile, readdir } from "node:fs/promises";

import { failReleaseVerification } from "./release-attestation-consumer.mjs";

export const releaseVerificationMaximumSizes = {
  tarball: 64 * 1024 * 1024,
  document: 16 * 1024 * 1024,
  bundle: 16 * 1024 * 1024,
  trustedRoot: 8 * 1024 * 1024,
};

export async function readRegularReleaseFile(path, maximumSize) {
  let metadata;
  try {
    metadata = await lstat(path);
  } catch {
    failReleaseVerification(
      "release_attestation_release_set_invalid",
      "The release attestation file set is invalid.",
    );
  }
  if (!metadata.isFile() || metadata.size <= 0 || metadata.size > maximumSize) {
    failReleaseVerification(
      "release_attestation_release_set_invalid",
      "The release attestation file set is invalid.",
    );
  }
  return readFile(path);
}

export async function validateExactReleaseDirectory(path, expected) {
  let entries;
  try {
    const metadata = await lstat(path);
    if (!metadata.isDirectory()) throw new Error("not a directory");
    entries = await readdir(path, { withFileTypes: true });
  } catch {
    failReleaseVerification(
      "release_attestation_release_set_invalid",
      "The release attestation file set is invalid.",
    );
  }
  const names = entries.map(({ name }) => name).sort();
  if (
    JSON.stringify(names) !== JSON.stringify([...expected].sort()) ||
    entries.some((entry) => !entry.isFile() && !entry.isDirectory())
  ) {
    failReleaseVerification(
      "release_attestation_release_set_invalid",
      "The release attestation file set is invalid.",
    );
  }
}

export async function assertReleaseFilesUnchanged(files) {
  for (const file of files) {
    const current = await readRegularReleaseFile(file.path, file.maximumSize);
    if (!current.equals(file.contents)) {
      failReleaseVerification(
        "release_attestation_release_set_changed",
        "The release attestation file set changed during verification.",
      );
    }
  }
}
