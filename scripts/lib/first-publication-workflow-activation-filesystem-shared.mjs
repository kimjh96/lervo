import { constants } from "node:fs";
import { lstat, open, readFile, rename, rm, rmdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { sha256 } from "./release-artifact-manifest.mjs";

export const workflowActivationJournalName = "journal.json";

export function failWorkflowActivation(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export function workflowActivationFailed() {
  failWorkflowActivation(
    "first_publication_workflow_activation_apply_failed",
    "The CLI first-publication workflow activation apply could not be completed; the original was restored.",
  );
}

export function workflowActivationRecoveryRequired() {
  failWorkflowActivation(
    "first_publication_workflow_activation_recovery_required",
    "The interrupted CLI first-publication workflow activation transaction must be recovered first.",
  );
}

export function workflowActivationSourceChanged() {
  failWorkflowActivation(
    "first_publication_workflow_activation_source_changed",
    "The CLI first-publication workflow activation source changed; no files were modified.",
  );
}

export function workflowActivationPaths(transactionRoot) {
  return {
    journal: resolve(transactionRoot, workflowActivationJournalName),
    journalNext: resolve(transactionRoot, ".journal.next"),
    next: resolve(transactionRoot, "workflow.next"),
    original: resolve(transactionRoot, "workflow.original"),
  };
}

export async function workflowActivationPathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    workflowActivationFailed();
  }
}

export async function syncWorkflowActivationDirectory(path) {
  if (process.platform === "win32") return;
  const handle = await open(path, constants.O_RDONLY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function assertWorkflowActivationContents(
  files,
  side,
  onFailure = workflowActivationFailed,
) {
  for (const file of files) {
    let contents;
    try {
      const metadata = await lstat(file.path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) onFailure();
      contents = await readFile(file.path);
    } catch {
      onFailure();
    }
    const expected = side === undefined ? file.binding : file.binding[side];
    if (contents.length !== expected.byteCount || sha256(contents) !== expected.sha256) {
      onFailure();
    }
  }
}

export async function removeWorkflowActivationTransaction(transactionRoot) {
  const paths = workflowActivationPaths(transactionRoot);
  await Promise.all([
    rm(paths.next, { force: true }),
    rm(paths.original, { force: true }),
    rm(paths.journalNext, { force: true }),
    rm(paths.journal, { force: true }),
  ]);
  await rmdir(transactionRoot);
  await syncWorkflowActivationDirectory(dirname(transactionRoot));
}

export async function rollbackWorkflowActivation(transactionRoot, workflowFile) {
  const paths = workflowActivationPaths(transactionRoot);
  if (await workflowActivationPathExists(paths.original)) {
    await assertWorkflowActivationContents(
      [
        {
          path: paths.original,
          binding: workflowFile.binding,
        },
      ],
      "before",
    );
    await rm(workflowFile.path, { force: true });
    await rename(paths.original, workflowFile.path);
    await syncWorkflowActivationDirectory(transactionRoot);
    await syncWorkflowActivationDirectory(dirname(workflowFile.path));
  }
  await assertWorkflowActivationContents([workflowFile], "before");
  await removeWorkflowActivationTransaction(transactionRoot);
}
