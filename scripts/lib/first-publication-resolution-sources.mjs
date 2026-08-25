import { isAbsolute } from "node:path";

import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationReconciliationReportSources } from "./first-publication-reconciliation-reader.mjs";
import { readFirstPublicationReconciliationSources } from "./first-publication-reconciliation-sources.mjs";
import { validateFirstPublicationResolutionDecision } from "./first-publication-resolution-decision.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";

const maximumInputBytes = 64 * 1024;

function fail() {
  throw new FirstPublicationBootstrapError(
    "first_publication_resolution_source_invalid",
    "The CLI first-publication result-resolution source is invalid.",
  );
}

function parseCanonical(contents) {
  try {
    const value = JSON.parse(contents.toString("utf8"));
    if (!contents.equals(Buffer.from(`${JSON.stringify(value, null, 2)}\n`))) fail();
    return value;
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
}

export async function readFirstPublicationResolutionSources(options, dependencies = {}) {
  if (
    !isAbsolute(options?.reconciliationReportPath ?? "") ||
    !isAbsolute(options?.decisionPath ?? "")
  )
    fail();
  const sources = await readFirstPublicationReconciliationSources(options, dependencies);
  let reportContents;
  let decisionContents;
  try {
    [reportContents, decisionContents] = await Promise.all([
      readRegularReleaseFile(options.reconciliationReportPath, maximumInputBytes),
      readRegularReleaseFile(options.decisionPath, maximumInputBytes),
    ]);
  } catch {
    fail();
  }
  const reconciliationReport = parseCanonical(reportContents);
  const decision = parseCanonical(decisionContents);
  validateFirstPublicationReconciliationReportSources(reconciliationReport, sources);
  validateFirstPublicationResolutionDecision(decision, {
    reconciliationReport,
    checkedAt: decision?.decidedAt,
  });
  return {
    ...sources,
    reconciliationReport,
    decision,
    assertUnchanged: async () => {
      await Promise.all([
        sources.assertUnchanged(),
        assertReleaseFilesUnchanged([
          {
            path: options.reconciliationReportPath,
            contents: reportContents,
            maximumSize: maximumInputBytes,
          },
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
