import { isAbsolute } from "node:path";

import { parseCanonicalReleaseJson } from "./bounded-release-json-source.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { readFirstPublicationStageEvidenceBundleSources } from "./first-publication-stage-evidence-bundle-sources.mjs";
import { validateFirstPublicationTransitionReceiptDocument } from "./first-publication-transition.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";

const maximumReceiptBytes = 64 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_completion_inspection_source_invalid",
    "The CLI first-publication completion-inspection source is invalid.",
  );
}

export async function readFirstPublicationCompletionInspectionSources(options, dependencies = {}) {
  if (
    !isAbsolute(options?.stageApprovalBundlePath ?? "") ||
    !isAbsolute(options?.transitionReceiptPath ?? "")
  )
    fail();
  let receiptContents;
  let transitionReceipt;
  try {
    receiptContents = await readRegularReleaseFile(
      options.transitionReceiptPath,
      maximumReceiptBytes,
    );
    transitionReceipt = validateFirstPublicationTransitionReceiptDocument(
      parseCanonicalReleaseJson(receiptContents),
    );
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
  const readBundleSources =
    dependencies.readBundleSources ?? readFirstPublicationStageEvidenceBundleSources;
  const bundleSources = await readBundleSources(options.stageApprovalBundlePath, dependencies);
  return {
    bundle: bundleSources.bundle,
    evidenceSet: bundleSources,
    transitionReceipt,
    assertUnchanged: async () => {
      await Promise.all([
        bundleSources.assertUnchanged(),
        assertReleaseFilesUnchanged([
          {
            path: options.transitionReceiptPath,
            contents: receiptContents,
            maximumSize: maximumReceiptBytes,
          },
        ]),
      ]);
    },
  };
}
