import { verifyCliFirstPublicationPackageMetadataPostApply } from "../metadata/cli-first-publication-package-metadata-post-apply.mjs";
import { FirstPublicationBootstrapError } from "../transition/first-publication-bootstrap.mjs";
import {
  createFirstPublicationExternalEvidenceReport,
  validateFirstPublicationExternalEvidenceReport,
} from "./first-publication-external-evidence-report.mjs";
import { validateFirstPublicationExternalEvidenceLocalInputs } from "./first-publication-external-evidence-policy.mjs";
import { readFirstPublicationExternalEvidenceSources } from "./first-publication-external-evidence-sources.mjs";
import { firstPublicationPackageMetadataPostApplySourcePaths } from "../metadata/first-publication-package-metadata-post-apply-sources.mjs";
import { observeNpmPublicPackage } from "../adapters/npm-public-package-observer.mjs";
import { canonicalJson } from "../../../shared/release-artifact-manifest.mjs";

function assertPostApplyReportMatches(saved, current) {
  if (canonicalJson(saved) !== canonicalJson(current)) {
    throw new FirstPublicationBootstrapError(
      "first_publication_external_evidence_post_apply_invalid",
      "The CLI first-publication package metadata post-apply verification result differs from the current sources.",
    );
  }
}

export async function inspectCliFirstPublicationExternalEvidence(
  options,
  metadataPaths = firstPublicationPackageMetadataPostApplySourcePaths,
  dependencies = {},
) {
  const readSources = dependencies.readSources ?? readFirstPublicationExternalEvidenceSources;
  const verifyPostApply =
    dependencies.verifyPostApply ?? verifyCliFirstPublicationPackageMetadataPostApply;
  const observePackage = dependencies.observePackage ?? observeNpmPublicPackage;
  const now = dependencies.now ?? (() => new Date().toISOString());
  const sources = await readSources(options);
  const currentPostApply = await verifyPostApply(options.receiptPath, metadataPaths, dependencies);
  assertPostApplyReportMatches(sources.postApplyReport, currentPostApply);
  validateFirstPublicationExternalEvidenceLocalInputs({
    ...sources,
    checkedAt: now(),
  });
  const packageObservation = await observePackage();
  const observedAt = now();
  const finalPostApply = await verifyPostApply(options.receiptPath, metadataPaths, dependencies);
  assertPostApplyReportMatches(currentPostApply, finalPostApply);
  assertPostApplyReportMatches(sources.postApplyReport, finalPostApply);
  const input = {
    ...sources,
    postApplyReport: finalPostApply,
    packageObservation,
    observedAt,
  };
  const createReport = dependencies.createReport ?? createFirstPublicationExternalEvidenceReport;
  const report = await createReport(input);
  validateFirstPublicationExternalEvidenceReport(report, input);
  await sources.assertUnchanged();
  return report;
}
