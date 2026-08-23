import { lstat, mkdir, open, rename } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertWorkflowActivationContents,
  failWorkflowActivation,
  removeWorkflowActivationTransaction,
  rollbackWorkflowActivation,
  syncWorkflowActivationDirectory,
  workflowActivationFailed,
  workflowActivationPathExists,
  workflowActivationPaths,
  workflowActivationRecoveryRequired,
  workflowActivationSourceChanged,
} from "./first-publication-workflow-activation-filesystem-shared.mjs";
import { canonicalJson } from "./release-artifact-manifest.mjs";

async function writeDurable(path, contents, mode) {
  const handle = await open(path, "wx", 0o600);
  try {
    await handle.writeFile(contents);
    await handle.chmod(mode);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function replaceJournal(transactionRoot, journal, first = false) {
  const paths = workflowActivationPaths(transactionRoot);
  if (first) {
    await writeDurable(
      paths.journal,
      Buffer.from(`${JSON.stringify(journal, null, 2)}\n`),
      0o600,
    );
  } else {
    await writeDurable(
      paths.journalNext,
      Buffer.from(`${JSON.stringify(journal, null, 2)}\n`),
      0o600,
    );
    await rename(paths.journalNext, paths.journal);
  }
  await syncWorkflowActivationDirectory(transactionRoot);
}

function validateInput({ transactionRoot, workflowFile, readOnlyFiles, plan }) {
  if (
    !isAbsolute(transactionRoot ?? "") || !isAbsolute(workflowFile?.path ?? "") ||
    !Buffer.isBuffer(workflowFile?.outputBytes) ||
    canonicalJson(workflowFile.binding) !== canonicalJson(plan?.workflow) ||
    !Array.isArray(readOnlyFiles) || readOnlyFiles.length !== plan?.readOnlySources?.length ||
    readOnlyFiles.some((file, index) =>
      !isAbsolute(file?.path ?? "") ||
      canonicalJson(file.binding) !== canonicalJson(plan.readOnlySources[index])
    )
  ) workflowActivationFailed();
}

export async function applyFirstPublicationWorkflowActivationFiles(input, dependencies = {}) {
  validateInput(input);
  const { transactionRoot, workflowFile, readOnlyFiles, plan } = input;
  await assertWorkflowActivationContents([workflowFile], "before", workflowActivationSourceChanged);
  await assertWorkflowActivationContents(readOnlyFiles, undefined, workflowActivationSourceChanged);
  let targetMode;
  try {
    const metadata = await lstat(workflowFile.path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) workflowActivationSourceChanged();
    targetMode = metadata.mode & 0o777;
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    workflowActivationSourceChanged();
  }
  try {
    await mkdir(transactionRoot, { mode: 0o700 });
    await syncWorkflowActivationDirectory(dirname(transactionRoot));
  } catch (error) {
    if (error?.code === "EEXIST") workflowActivationRecoveryRequired();
    workflowActivationFailed();
  }
  const journal = {
    schemaVersion: 1,
    transactionType: plan.transactionType,
    planDigest: plan.planDigest,
    ownerPid: dependencies.ownerPid ?? process.pid,
    phase: "preparing",
    workflow: plan.workflow,
  };
  let interrupted = false;
  const checkpoint = async (name) => {
    if (await dependencies.failureInjector?.(name) === "interrupt") {
      interrupted = true;
      throw new Error("simulated interruption");
    }
  };
  try {
    await replaceJournal(transactionRoot, journal, true);
    await writeDurable(
      workflowActivationPaths(transactionRoot).next,
      workflowFile.outputBytes,
      targetMode,
    );
    journal.phase = "staged";
    await replaceJournal(transactionRoot, journal);
    await checkpoint("staged");
    await assertWorkflowActivationContents([workflowFile], "before");
    await assertWorkflowActivationContents(readOnlyFiles);
    await rename(workflowFile.path, workflowActivationPaths(transactionRoot).original);
    await syncWorkflowActivationDirectory(dirname(workflowFile.path));
    await syncWorkflowActivationDirectory(transactionRoot);
    journal.phase = "original_moved";
    await replaceJournal(transactionRoot, journal);
    await checkpoint("original_moved");
    await rename(workflowActivationPaths(transactionRoot).next, workflowFile.path);
    await syncWorkflowActivationDirectory(transactionRoot);
    await syncWorkflowActivationDirectory(dirname(workflowFile.path));
    journal.phase = "committed";
    await replaceJournal(transactionRoot, journal);
    await checkpoint("committed");
    await assertWorkflowActivationContents([workflowFile], "after");
    await assertWorkflowActivationContents(readOnlyFiles);
    await removeWorkflowActivationTransaction(transactionRoot);
    return { journal: "removed", rollback: "not_required", recovery: "not_required" };
  } catch {
    if (interrupted || journal.phase === "committed") workflowActivationRecoveryRequired();
    try {
      await rollbackWorkflowActivation(transactionRoot, workflowFile);
    } catch {
      failWorkflowActivation(
        "first_publication_workflow_activation_rollback_failed",
        "The original workflow could not be restored after CLI first-publication workflow activation failed.",
      );
    }
    workflowActivationFailed();
  }
}

export async function assertNoFirstPublicationWorkflowActivationTransaction(transactionRoot) {
  if (!isAbsolute(transactionRoot ?? "")) workflowActivationFailed();
  if (await workflowActivationPathExists(transactionRoot)) {
    workflowActivationRecoveryRequired();
  }
}
