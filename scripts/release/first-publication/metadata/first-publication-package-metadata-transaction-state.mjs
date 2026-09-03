import { lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import { repositoryRoot } from "../../../distribution/lib/installed-cli.mjs";

export const firstPublicationPackageMetadataTransactionRoot = resolve(
  repositoryRoot,
  "apps/cli/.lervo-metadata-apply-transaction",
);

function fail(code, message) {
  throw new FirstPublicationBootstrapError(code, message);
}

export async function inspectFirstPublicationPackageMetadataTransactionState(transactionRoot) {
  if (!isAbsolute(transactionRoot ?? "")) {
    fail(
      "first_publication_package_metadata_post_apply_transaction_invalid",
      "The CLI first-publication package metadata transaction state could not be determined.",
    );
  }
  let metadata;
  try {
    metadata = await lstat(transactionRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "clear" };
    fail(
      "first_publication_package_metadata_post_apply_transaction_invalid",
      "The CLI first-publication package metadata transaction state could not be determined.",
    );
  }
  if (!metadata.isDirectory()) {
    fail(
      "first_publication_package_metadata_post_apply_transaction_invalid",
      "The CLI first-publication package metadata transaction state could not be determined.",
    );
  }
  return { status: "recovery_required" };
}

export function assertFirstPublicationPackageMetadataTransactionClear(state) {
  if (state?.status !== "clear") {
    fail(
      "first_publication_package_metadata_post_apply_transaction_pending",
      "The interrupted CLI first-publication package metadata transaction must be recovered first.",
    );
  }
  return state;
}
