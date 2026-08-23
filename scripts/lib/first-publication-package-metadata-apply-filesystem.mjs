import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rmdir,
  writeFile,
} from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertMetadataApplyContents,
  failMetadataApply,
  metadataApplyFailed,
  metadataApplyJournalName,
  metadataApplyPathExists,
  metadataApplyPaths,
  metadataApplyRecoveryRequired,
  metadataApplySourceChanged,
  removeMetadataApplyTransactionFiles,
  rollbackMetadataApplyFiles,
} from "./first-publication-package-metadata-apply-filesystem-shared.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

async function writeOwnerFile(path, contents, mode = 0o600) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await chmod(path, mode);
}

async function replaceJournal(transactionRoot, journal) {
  const target = resolve(transactionRoot, metadataApplyJournalName);
  const staged = resolve(transactionRoot, ".journal.next");
  await writeFile(staged, `${JSON.stringify(journal, null, 2)}\n`, { mode: 0o600 });
  await rename(staged, target);
}

function validateInput({ transactionRoot, files, readOnlyFiles = [], plan }) {
  if (
    !isAbsolute(transactionRoot ?? "") ||
    !Array.isArray(files) || files.length !== 3 ||
    files.some((file, index) =>
      !isAbsolute(file?.path ?? "") ||
      !Buffer.isBuffer(file.outputBytes) ||
      canonicalJson(file.binding) !== canonicalJson(plan.files[index])
    ) ||
    new Set(files.map(({ path }) => path)).size !== files.length ||
    !Array.isArray(readOnlyFiles) || readOnlyFiles.length !== plan.readOnlySources.length ||
    readOnlyFiles.some((file, index) =>
      !isAbsolute(file?.path ?? "") ||
      canonicalJson(file.binding?.before) !== canonicalJson(plan.readOnlySources[index])
    )
  ) metadataApplyFailed();
}

export async function applyFirstPublicationPackageMetadataFiles(input, dependencies = {}) {
  validateInput(input);
  const { transactionRoot, files, readOnlyFiles, plan } = input;
  await assertMetadataApplyContents(
    [...files, ...readOnlyFiles],
    "before",
    metadataApplySourceChanged,
  );
  let targetModes;
  try {
    targetModes = await Promise.all(files.map(async ({ path }) => {
      const metadata = await lstat(path);
      if (!metadata.isFile()) metadataApplySourceChanged();
      return metadata.mode & 0o777;
    }));
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    metadataApplySourceChanged();
  }
  try {
    await mkdir(transactionRoot, { mode: 0o700 });
  } catch (error) {
    if (error?.code === "EEXIST") metadataApplyRecoveryRequired();
    metadataApplyFailed();
  }
  const journal = {
    schemaVersion: 1,
    transactionType: plan.transactionType,
    planDigest: plan.planDigest,
    ownerPid: dependencies.ownerPid ?? process.pid,
    phase: "preparing",
    publishedCount: 0,
    movedIndex: null,
    files: plan.files,
  };
  let leaveForRecovery = false;
  const checkpoint = async (name) => {
    const result = await dependencies.failureInjector?.(name);
    if (result === "interrupt") {
      leaveForRecovery = true;
      throw new Error("simulated interruption");
    }
  };
  try {
    for (let index = 0; index < files.length; index += 1) {
      const paths = metadataApplyPaths(transactionRoot, index);
      await writeOwnerFile(paths.next, files[index].outputBytes, targetModes[index]);
    }
    journal.phase = "staged";
    await replaceJournal(transactionRoot, journal);
    await checkpoint("staged");
    await assertMetadataApplyContents([...files, ...readOnlyFiles], "before");
    for (let index = 0; index < files.length; index += 1) {
      const paths = metadataApplyPaths(transactionRoot, index);
      await rename(files[index].path, paths.original);
      journal.phase = "publishing";
      journal.movedIndex = index;
      await replaceJournal(transactionRoot, journal);
      await checkpoint(`original_moved:${index}`);
      await rename(paths.next, files[index].path);
      journal.publishedCount = index + 1;
      journal.movedIndex = null;
      await replaceJournal(transactionRoot, journal);
      await checkpoint(`published:${index}`);
    }
    await assertMetadataApplyContents(files, "after");
    await assertMetadataApplyContents(readOnlyFiles, "before");
    journal.phase = "committed";
    await replaceJournal(transactionRoot, journal);
    await checkpoint("committed");
    await removeMetadataApplyTransactionFiles(transactionRoot, files.length);
    return { journal: "removed", rollback: "not_required", recovery: "not_required" };
  } catch {
    if (leaveForRecovery || journal.phase === "committed") metadataApplyRecoveryRequired();
    try {
      await rollbackMetadataApplyFiles(transactionRoot, files);
    } catch {
      failMetadataApply(
        "first_publication_package_metadata_apply_rollback_failed",
        "The originals could not be restored after CLI first-publication package metadata apply failed.",
      );
    }
    metadataApplyFailed();
  }
}

export async function assertNoFirstPublicationPackageMetadataTransaction(transactionRoot) {
  if (!isAbsolute(transactionRoot ?? "")) metadataApplyFailed();
  if (await metadataApplyPathExists(transactionRoot)) {
    try {
      if ((await readdir(transactionRoot)).length === 0) {
        await rmdir(transactionRoot);
        return;
      }
    } catch {
      metadataApplyRecoveryRequired();
    }
    metadataApplyRecoveryRequired();
  }
}
