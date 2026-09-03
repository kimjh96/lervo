import { access, readFile, rename, rm, rmdir } from "node:fs/promises";
import { resolve } from "node:path";

import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import { sha256 } from "../../../shared/release-artifact-manifest.mjs";

export const metadataApplyJournalName = "journal.json";

export function failMetadataApply(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export function metadataApplyFailed() {
  failMetadataApply(
    "first_publication_package_metadata_apply_failed",
    "The CLI first-publication package metadata apply could not be completed; the originals were restored.",
  );
}

export function metadataApplyRecoveryRequired() {
  failMetadataApply(
    "first_publication_package_metadata_apply_recovery_required",
    "The interrupted CLI first-publication package metadata apply must be recovered first.",
  );
}

export function metadataApplySourceChanged() {
  failMetadataApply(
    "first_publication_package_metadata_apply_source_changed",
    "The CLI first-publication package metadata apply source changed; no files were modified.",
  );
}

export function metadataApplyPaths(transactionRoot, index) {
  return {
    next: resolve(transactionRoot, `${index}.next`),
    original: resolve(transactionRoot, `${index}.original`),
  };
}

export async function metadataApplyPathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

export async function assertMetadataApplyContents(files, side, onFailure = metadataApplyFailed) {
  for (const file of files) {
    let contents;
    try {
      contents = await readFile(file.path);
    } catch {
      onFailure();
    }
    const expected = file.binding[side];
    if (contents.length !== expected.byteCount || sha256(contents) !== expected.sha256) {
      onFailure();
    }
  }
}

export async function removeMetadataApplyTransactionFiles(transactionRoot, fileCount) {
  for (let index = 0; index < fileCount; index += 1) {
    const paths = metadataApplyPaths(transactionRoot, index);
    await rm(paths.next, { force: true });
    await rm(paths.original, { force: true });
  }
  await rm(resolve(transactionRoot, ".journal.next"), { force: true });
  await rm(resolve(transactionRoot, metadataApplyJournalName), { force: true });
  await rmdir(transactionRoot);
}

export async function rollbackMetadataApplyFiles(transactionRoot, files) {
  for (let index = files.length - 1; index >= 0; index -= 1) {
    const paths = metadataApplyPaths(transactionRoot, index);
    if (await metadataApplyPathExists(paths.original)) {
      await rm(files[index].path, { force: true });
      await rename(paths.original, files[index].path);
    }
  }
  await assertMetadataApplyContents(files, "before");
  await removeMetadataApplyTransactionFiles(transactionRoot, files.length);
}
