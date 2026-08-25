import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { verifyCliFirstPublicationPackageMetadataPostApply } from "../../lib/cli-first-publication-package-metadata-post-apply.mjs";
import {
  applyMetadataFixture,
  createMetadataApplyFixture,
} from "./first-publication-metadata-apply.mjs";
import { createFirstPublicationFixture } from "./first-publication.mjs";

async function writeDocument(path, document) {
  await writeFile(path, `${JSON.stringify(document, null, 2)}\n`);
}

export async function createExternalEvidenceFixture() {
  const metadata = await createMetadataApplyFixture();
  const applied = await applyMetadataFixture(metadata);
  const postApplyReport = await verifyCliFirstPublicationPackageMetadataPostApply(
    applied.receiptPath,
    metadata.paths,
    {
      transactionRoot: metadata.transactionRoot,
      generateRelease: async () => metadata.derivedRelease.releaseManifest,
    },
  );
  const publication = createFirstPublicationFixture({
    version: postApplyReport.target.version,
  });
  const licenseApproval = {
    schemaVersion: 1,
    evidenceType: "first_publication_license_approval",
    approvalId: "lic_fixture1",
    decision: "approve_public_distribution_license",
    approvedAt: "2026-08-21T02:30:00Z",
    approver: { kind: "user", id: "legal-owner@example.invalid" },
    target: {
      package: postApplyReport.target.package,
      repository: postApplyReport.target.repository,
      license: postApplyReport.target.license,
      postApplyReportDigest: postApplyReport.reportDigest,
    },
    basis: "operator_attestation",
  };
  const scopeConfirmation = {
    schemaVersion: 1,
    evidenceType: "first_publication_npm_scope_control_confirmation",
    confirmationId: "scp_fixture1",
    decision: "confirm_npm_scope_control",
    confirmedAt: "2026-08-21T02:45:00Z",
    expiresAt: "2026-08-21T04:00:00Z",
    confirmer: { kind: "user", id: "npm-owner@example.invalid" },
    target: {
      package: postApplyReport.target.package,
      scopeOwner: { kind: "organization", name: "lervo" },
      postApplyReportDigest: postApplyReport.reportDigest,
    },
    basis: "operator_attestation",
  };
  const documents = {
    postApplyReport,
    publicationAuthorization: publication.publicationAuthorization,
    licenseApproval,
    scopeConfirmation,
    firstPublicationApproval: publication.approval,
  };
  const paths = Object.fromEntries(
    Object.keys(documents).map((id) => [`${id}Path`, resolve(metadata.root, `${id}.json`)]),
  );
  await Promise.all(
    Object.entries(documents).map(([id, document]) => writeDocument(paths[`${id}Path`], document)),
  );
  return {
    ...metadata,
    ...applied,
    documents,
    evidencePaths: { ...paths, receiptPath: applied.receiptPath },
    observedAt: "2026-08-21T03:00:00Z",
    packageObservation: publication.packageObservation,
  };
}
