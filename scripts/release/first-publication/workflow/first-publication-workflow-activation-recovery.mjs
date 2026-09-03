import { lstat, readFile } from "node:fs/promises";
import { isAbsolute } from "node:path";

import {
  assertWorkflowActivationContents,
  failWorkflowActivation,
  removeWorkflowActivationTransaction,
  rollbackWorkflowActivation,
  workflowActivationPathExists,
  workflowActivationPaths,
} from "./first-publication-workflow-activation-filesystem-shared.mjs";
import { canonicalJson } from "../../../shared/release-artifact-manifest.mjs";

const digestPattern = /^sha256:[a-f0-9]{64}$/u;
const maximumJournalBytes = 64 * 1024;

function invalidJournal() {
  failWorkflowActivation(
    "first_publication_workflow_activation_journal_invalid",
    "The CLI first-publication workflow activation recovery record is invalid.",
  );
}

function exactKeys(value, keys) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    canonicalJson(Object.keys(value).sort()) === canonicalJson([...keys].sort())
  );
}

function validateJournal(journal) {
  const workflow = journal?.workflow;
  if (
    !exactKeys(journal, [
      "ownerPid",
      "phase",
      "planDigest",
      "schemaVersion",
      "transactionType",
      "workflow",
    ]) ||
    journal.schemaVersion !== 1 ||
    journal.transactionType !== "first_publication_stage_only_workflow_activation" ||
    !digestPattern.test(journal.planDigest ?? "") ||
    !Number.isSafeInteger(journal.ownerPid) ||
    journal.ownerPid < 1 ||
    !["preparing", "staged", "original_moved", "committed"].includes(journal.phase) ||
    !exactKeys(workflow, ["after", "before", "id", "relativePath"]) ||
    workflow.id !== "releaseWorkflow" ||
    workflow.relativePath !== ".github/workflows/cli-release-matrix.yml" ||
    !exactKeys(workflow.before, ["byteCount", "sha256"]) ||
    !Number.isSafeInteger(workflow.before?.byteCount) ||
    workflow.before.byteCount < 1 ||
    !digestPattern.test(workflow.before?.sha256 ?? "") ||
    !exactKeys(workflow.after, ["byteCount", "sha256"]) ||
    !Number.isSafeInteger(workflow.after?.byteCount) ||
    workflow.after.byteCount < 1 ||
    !digestPattern.test(workflow.after?.sha256 ?? "") ||
    workflow.before.sha256 === workflow.after.sha256
  )
    invalidJournal();
  return journal;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

export async function recoverFirstPublicationWorkflowActivationFiles({
  transactionRoot,
  workflowPath,
}) {
  if (!isAbsolute(transactionRoot ?? "") || !isAbsolute(workflowPath ?? "")) {
    invalidJournal();
  }
  if (!(await workflowActivationPathExists(transactionRoot))) {
    failWorkflowActivation(
      "first_publication_workflow_activation_recovery_not_found",
      "There is no CLI first-publication workflow activation transaction to recover.",
    );
  }
  try {
    const metadata = await lstat(transactionRoot);
    if (
      !metadata.isDirectory() ||
      metadata.isSymbolicLink() ||
      (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
    )
      invalidJournal();
  } catch {
    invalidJournal();
  }
  let journal;
  try {
    const journalPath = workflowActivationPaths(transactionRoot).journal;
    const metadata = await lstat(journalPath);
    if (
      !metadata.isFile() ||
      metadata.isSymbolicLink() ||
      metadata.size < 1 ||
      metadata.size > maximumJournalBytes ||
      (process.platform !== "win32" && (metadata.mode & 0o077) !== 0)
    )
      invalidJournal();
    const contents = await readFile(journalPath);
    const parsed = JSON.parse(contents.toString("utf8"));
    if (!contents.equals(Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`))) {
      invalidJournal();
    }
    journal = validateJournal(parsed);
  } catch (error) {
    if (error?.code?.startsWith("first_publication_")) throw error;
    invalidJournal();
  }
  if (processIsAlive(journal.ownerPid)) {
    failWorkflowActivation(
      "first_publication_workflow_activation_busy",
      "The CLI first-publication workflow activation transaction is still running.",
    );
  }
  const workflowFile = { path: workflowPath, binding: journal.workflow };
  if (journal.phase === "committed") {
    await assertWorkflowActivationContents([workflowFile], "after", invalidJournal);
    await removeWorkflowActivationTransaction(transactionRoot);
    return { status: "committed_cleanup_completed" };
  }
  try {
    await rollbackWorkflowActivation(transactionRoot, workflowFile);
  } catch {
    failWorkflowActivation(
      "first_publication_workflow_activation_rollback_failed",
      "The original CLI first-publication workflow could not be restored.",
    );
  }
  return { status: "rolled_back" };
}
