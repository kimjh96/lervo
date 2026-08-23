import { lstat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { parseCanonicalReleaseJson } from "./bounded-release-json-source.mjs";
import { FirstPublicationBootstrapError } from "./first-publication-bootstrap.mjs";
import { validateFirstPublicationStageEvidenceBundleDocument } from
  "./first-publication-stage-evidence-bundle.mjs";
import { resolveFirstPublicationStageEvidenceBundlePath } from
  "./first-publication-stage-evidence-bundle-paths.mjs";
import { readFirstPublicationStageEvidenceSetSources } from
  "./first-publication-stage-evidence-set-sources.mjs";
import {
  assertReleaseFilesUnchanged,
  readRegularReleaseFile,
} from "./release-attestation-file-set.mjs";

const maximumBundleBytes = 16 * 1024;

function fail(code = "first_publication_stage_evidence_bundle_source_invalid") {
  throw new FirstPublicationBootstrapError(
    code,
    "The CLI first-publication stage evidence bundle source is invalid.",
  );
}

function assertDigests(bundle, evidenceSet) {
  const sources = bundle.sources;
  if (
    sources.stageReviewReport.digest !== evidenceSet.stageReviewReport.evidenceDigest ||
    sources.decision.digest !== evidenceSet.decision.decisionDigest ||
    sources.authorization.digest !== evidenceSet.authorization.authorizationDigest ||
    sources.approvalResult.attemptDigest !== evidenceSet.attempt.attemptDigest ||
    sources.approvalResult.terminalDigest !== evidenceSet.terminal.terminalDigest ||
    sources.reconciliationReport.digest !== evidenceSet.reconciliationReport.evidenceDigest
  ) fail("first_publication_stage_evidence_bundle_source_mismatch");
}

export async function readFirstPublicationStageEvidenceBundleSources(
  manifestPath,
  dependencies = {},
) {
  if (!isAbsolute(manifestPath ?? "")) fail();
  let manifestContents;
  let bundle;
  try {
    const metadata = await lstat(manifestPath);
    if (process.platform !== "win32" && (metadata.mode & 0o077) !== 0) fail();
    manifestContents = await readRegularReleaseFile(manifestPath, maximumBundleBytes);
    bundle = validateFirstPublicationStageEvidenceBundleDocument(
      parseCanonicalReleaseJson(manifestContents),
    );
  } catch (error) {
    if (error instanceof FirstPublicationBootstrapError) throw error;
    fail();
  }
  const paths = {
    stageReviewReportPath: resolveFirstPublicationStageEvidenceBundlePath(
      manifestPath,
      bundle.sources.stageReviewReport.path,
    ),
    decisionPath: resolveFirstPublicationStageEvidenceBundlePath(
      manifestPath,
      bundle.sources.decision.path,
    ),
    authorizationPath: resolveFirstPublicationStageEvidenceBundlePath(
      manifestPath,
      bundle.sources.authorization.path,
    ),
    resultDirectory: resolveFirstPublicationStageEvidenceBundlePath(
      manifestPath,
      bundle.sources.approvalResult.directory,
    ),
    reconciliationReportPath: resolveFirstPublicationStageEvidenceBundlePath(
      manifestPath,
      bundle.sources.reconciliationReport.path,
    ),
  };
  const readEvidenceSet = dependencies.readEvidenceSet ??
    readFirstPublicationStageEvidenceSetSources;
  const evidenceSet = await readEvidenceSet(paths, dependencies);
  assertDigests(bundle, evidenceSet);
  return {
    ...evidenceSet,
    bundle,
    paths,
    assertUnchanged: async () => {
      await Promise.all([
        evidenceSet.assertUnchanged(),
        assertReleaseFilesUnchanged([{
          path: manifestPath,
          contents: manifestContents,
          maximumSize: maximumBundleBytes,
        }]),
      ]);
    },
  };
}
