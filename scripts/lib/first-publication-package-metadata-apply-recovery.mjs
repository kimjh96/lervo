import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import {
  assertMetadataApplyContents,
  failMetadataApply,
  metadataApplyFailed,
  metadataApplyJournalName,
  metadataApplyPathExists,
  removeMetadataApplyTransactionFiles,
  rollbackMetadataApplyFiles,
} from "./first-publication-package-metadata-apply-filesystem-shared.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

function validateJournal(journal) {
  const validBindings =
    Array.isArray(journal?.files) &&
    journal.files.every(
      (file) =>
        Number.isSafeInteger(file?.before?.byteCount) &&
        file.before.byteCount > 0 &&
        /^sha256:[a-f0-9]{64}$/u.test(file.before.sha256 ?? "") &&
        Number.isSafeInteger(file?.after?.byteCount) &&
        file.after.byteCount > 0 &&
        /^sha256:[a-f0-9]{64}$/u.test(file.after.sha256 ?? ""),
    );
  if (
    journal?.schemaVersion !== 1 ||
    journal.transactionType !== "first_publication_package_metadata_apply" ||
    !/^sha256:[a-f0-9]{64}$/u.test(journal.planDigest ?? "") ||
    !Number.isSafeInteger(journal.ownerPid) ||
    journal.ownerPid < 1 ||
    !["preparing", "staged", "publishing", "committed"].includes(journal.phase) ||
    !validBindings ||
    journal.files.length !== 3 ||
    canonicalJson(journal.files.map(({ id, relativePath }) => ({ id, relativePath }))) !==
      canonicalJson([
        { id: "packageManifest", relativePath: "apps/cli/package.json" },
        {
          id: "releaseManifest",
          relativePath: "apps/cli/release-artifact-manifest.json",
        },
        { id: "releaseSbom", relativePath: "apps/cli/release-sbom.cdx.json" },
      ])
  ) {
    failMetadataApply(
      "first_publication_package_metadata_apply_journal_invalid",
      "The CLI first-publication package metadata apply recovery record is invalid.",
    );
  }
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function recoverFirstPublicationPackageMetadataFiles({ transactionRoot, targets }) {
  if (
    !isAbsolute(transactionRoot ?? "") ||
    targets === null ||
    typeof targets !== "object" ||
    ["packageManifest", "releaseManifest", "releaseSbom"].some(
      (id) => !isAbsolute(targets?.[id] ?? ""),
    ) ||
    new Set(Object.values(targets)).size !== 3
  )
    metadataApplyFailed();
  if (!(await metadataApplyPathExists(transactionRoot))) {
    failMetadataApply(
      "first_publication_package_metadata_apply_recovery_not_found",
      "There is no CLI first-publication package metadata apply transaction to recover.",
    );
  }
  let journal;
  try {
    journal = JSON.parse(
      await readFile(resolve(transactionRoot, metadataApplyJournalName), "utf8"),
    );
  } catch {
    failMetadataApply(
      "first_publication_package_metadata_apply_journal_invalid",
      "The CLI first-publication package metadata apply recovery record is invalid.",
    );
  }
  validateJournal(journal);
  if (processIsAlive(journal.ownerPid)) {
    failMetadataApply(
      "first_publication_package_metadata_apply_busy",
      "The CLI first-publication package metadata apply transaction is still running.",
    );
  }
  const files = journal.files.map((binding) => ({ path: targets[binding.id], binding }));
  if (journal.phase === "committed") {
    await assertMetadataApplyContents(files, "after");
    await removeMetadataApplyTransactionFiles(transactionRoot, files.length);
    return { status: "committed_cleanup_completed" };
  }
  try {
    await rollbackMetadataApplyFiles(transactionRoot, files);
  } catch {
    failMetadataApply(
      "first_publication_package_metadata_apply_rollback_failed",
      "The original files could not be restored after the CLI first-publication package metadata apply failed.",
    );
  }
  return { status: "rolled_back" };
}
