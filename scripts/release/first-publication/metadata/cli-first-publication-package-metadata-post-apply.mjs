import { parse } from "yaml";

import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import { validateFirstPublicationPackageMetadataApplyReceiptDocument } from "./first-publication-package-metadata-apply-receipt.mjs";
import {
  firstPublicationPackageMetadataPostApplySourcePaths,
  readFirstPublicationPackageMetadataPostApplySources,
} from "./first-publication-package-metadata-post-apply-sources.mjs";
import { generateFirstPublicationPackageMetadataPostApplyRelease } from "./first-publication-package-metadata-post-apply-release.mjs";
import {
  createFirstPublicationPackageMetadataPostApplyReport,
  validateFirstPublicationPackageMetadataPostApplyReport,
} from "./first-publication-package-metadata-post-apply-verification.mjs";
import {
  assertFirstPublicationPackageMetadataTransactionClear,
  firstPublicationPackageMetadataTransactionRoot,
  inspectFirstPublicationPackageMetadataTransactionState,
} from "./first-publication-package-metadata-transaction-state.mjs";

function parseLockfile(contents) {
  try {
    return parse(contents.toString("utf8"));
  } catch {
    throw new FirstPublicationBootstrapError(
      "first_publication_package_metadata_post_apply_release_inconsistent",
      "The CLI first-publication package metadata does not match the release sources.",
    );
  }
}

export async function verifyCliFirstPublicationPackageMetadataPostApply(
  receiptPath,
  paths = firstPublicationPackageMetadataPostApplySourcePaths,
  dependencies = {},
) {
  const inspectTransaction =
    dependencies.inspectTransaction ?? inspectFirstPublicationPackageMetadataTransactionState;
  const transactionState = await inspectTransaction(
    dependencies.transactionRoot ?? firstPublicationPackageMetadataTransactionRoot,
  );
  assertFirstPublicationPackageMetadataTransactionClear(transactionState);
  const readSources =
    dependencies.readSources ?? readFirstPublicationPackageMetadataPostApplySources;
  const sources = await readSources(paths, receiptPath);
  validateFirstPublicationPackageMetadataApplyReceiptDocument(sources.receipt);
  const generateRelease =
    dependencies.generateRelease ?? generateFirstPublicationPackageMetadataPostApplyRelease;
  const generatedReleaseManifest = await generateRelease(
    {
      packageManifest: sources.packageManifest,
      releaseManifest: sources.releaseManifest,
    },
    dependencies,
  );
  const input = {
    ...sources,
    transactionState,
    generatedReleaseManifest,
    lockfile: parseLockfile(sources.sourceSnapshots.lockfile.contents),
  };
  const createReport =
    dependencies.createReport ?? createFirstPublicationPackageMetadataPostApplyReport;
  const report = await createReport(input);
  validateFirstPublicationPackageMetadataPostApplyReport(report, input);
  await sources.assertUnchanged();
  assertFirstPublicationPackageMetadataTransactionClear(
    await inspectTransaction(
      dependencies.transactionRoot ?? firstPublicationPackageMetadataTransactionRoot,
    ),
  );
  return report;
}
