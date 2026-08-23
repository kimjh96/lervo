import { lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { repositoryRoot } from "./installed-cli.mjs";

export const firstPublicationWorkflowActivationTransactionRoot = resolve(
  repositoryRoot,
  ".github/.lervo-workflow-activation-transaction",
);

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export async function inspectFirstPublicationWorkflowActivationTransactionState(
  transactionRoot,
) {
  if (!isAbsolute(transactionRoot ?? "")) {
    fail(
      "first_publication_workflow_activation_post_apply_transaction_invalid",
      "The CLI first-publication workflow activation transaction state could not be determined.",
    );
  }
  let metadata;
  try {
    metadata = await lstat(transactionRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "clear" };
    fail(
      "first_publication_workflow_activation_post_apply_transaction_invalid",
      "The CLI first-publication workflow activation transaction state could not be determined.",
    );
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    fail(
      "first_publication_workflow_activation_post_apply_transaction_invalid",
      "The CLI first-publication workflow activation transaction state could not be determined.",
    );
  }
  return { status: "recovery_required" };
}

export function assertFirstPublicationWorkflowActivationTransactionClear(state) {
  if (state?.status !== "clear") {
    fail(
      "first_publication_workflow_activation_post_apply_transaction_pending",
      "The interrupted CLI first-publication workflow activation transaction must be recovered first.",
    );
  }
  return state;
}
