import { isAbsolute } from "node:path";

import { readFirstPublicationContractFiles } from "./first-publication-contract-files.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";

const maximumInputBytes = 64 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_arming_source_invalid",
    "The CLI first-publication execution authorization source is invalid.",
  );
}

function parseDecision(contents) {
  try {
    const decision = JSON.parse(contents.toString("utf8"));
    if (!contents.equals(Buffer.from(`${JSON.stringify(decision, null, 2)}\n`))) fail();
    return decision;
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
}

export async function readFirstPublicationArmingSources(options) {
  if (!isAbsolute(options?.decisionPath ?? "")) fail();
  const contracts = await readFirstPublicationContractFiles(options);
  let decisionContents;
  try {
    decisionContents = await readRegularReleaseFile(options.decisionPath, maximumInputBytes);
  } catch {
    fail();
  }
  return {
    bootstrap: contracts.bootstrap,
    publicationAuthorization: contracts.publicationAuthorization,
    decision: parseDecision(decisionContents),
    assertUnchanged: async () => {
      await Promise.all([
        contracts.assertUnchanged(),
        assertReleaseFilesUnchanged([
          {
            path: options.decisionPath,
            contents: decisionContents,
            maximumSize: maximumInputBytes,
          },
        ]),
      ]);
    },
  };
}
