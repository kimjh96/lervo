import { lstat } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { repositoryRoot } from "./installed-cli.mjs";

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
      "CLI 최초 게시 package metadata transaction 상태를 확인할 수 없습니다.",
    );
  }
  let metadata;
  try {
    metadata = await lstat(transactionRoot);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "clear" };
    fail(
      "first_publication_package_metadata_post_apply_transaction_invalid",
      "CLI 최초 게시 package metadata transaction 상태를 확인할 수 없습니다.",
    );
  }
  if (!metadata.isDirectory()) {
    fail(
      "first_publication_package_metadata_post_apply_transaction_invalid",
      "CLI 최초 게시 package metadata transaction 상태를 확인할 수 없습니다.",
    );
  }
  return { status: "recovery_required" };
}

export function assertFirstPublicationPackageMetadataTransactionClear(state) {
  if (state?.status !== "clear") {
    fail(
      "first_publication_package_metadata_post_apply_transaction_pending",
      "중단된 CLI 최초 게시 package metadata transaction을 먼저 복구해야 합니다.",
    );
  }
  return state;
}
