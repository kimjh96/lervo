import { createFirstPublicationBootstrapAuthorization } from
  "../../lib/first-publication-bootstrap-authorization.mjs";
import { createFirstPublicationArmingAuthorization } from
  "../../lib/first-publication-arming-authorization.mjs";
import { firstPublicationArmingConfirmations } from
  "../../lib/first-publication-arming-decision.mjs";
import { createFirstPublicationExecutionPlan } from
  "../../lib/first-publication-execution-plan.mjs";
import { createFirstPublicationExternalEvidenceReport } from
  "../../lib/first-publication-external-evidence-report.mjs";
import {
  createReleasePublicationArtifact,
  createReleasePublicationAuthorization,
  npmPublicRegistry,
} from "../../lib/release-publication-authorization.mjs";

export const firstPublicationRepository = "lervo-dev/lervo";

export function createFirstPublicationFixture({
  tarballContents = Buffer.from("first-publication-fixture-tarball"),
  approvalId = "apr_fixture1",
  armingDecisionId = "arm_fixture1",
  version = "0.1.0",
  sourceDigest = "a".repeat(40),
} = {}) {
  const artifact = createReleasePublicationArtifact(
    `lervo-cli-${version}.tgz`,
    version,
    tarballContents,
  );
  const publicationAuthorization = createReleasePublicationAuthorization({
    verification: {
      schemaVersion: 1,
      status: "verified",
      repository: firstPublicationRepository,
      workflow: ".github/workflows/cli-release-matrix.yml",
      tag: `v${version}`,
      sourceDigest,
      subjects: [
        { name: artifact.file, digest: { sha256: artifact.sha256 } },
        { name: "release-artifact-manifest.json", digest: { sha256: "b".repeat(64) } },
        { name: "release-sbom.cdx.json", digest: { sha256: "c".repeat(64) } },
      ],
    },
    version,
    distTag: "latest",
    artifact,
  });
  const approval = {
    schemaVersion: 1,
    approvalId,
    decision: "approve_first_publication",
    approvedAt: "2026-08-21T02:55:00Z",
    expiresAt: "2026-08-21T04:00:00Z",
    approver: { kind: "user", id: "release-owner@example.invalid" },
    target: {
      package: "@lervo/cli",
      repository: firstPublicationRepository,
      license: "Apache-2.0",
      scopeOwner: { kind: "organization", name: "lervo" },
      publicationAuthorizationDigest: publicationAuthorization.authorizationDigest,
    },
    confirmations: [
      "license_approved",
      "one_time_direct_publish_approved",
      "package_name_availability_confirmed",
      "scope_control_confirmed",
      "stage_only_transition_required",
    ],
  };
  const packageObservation = {
    schemaVersion: 1,
    source: "npm_public_registry",
    state: "not_found",
    package: "@lervo/cli",
  };
  const postApplyReport = {
    status: "verified",
    activation: "not_implemented",
    target: {
      package: "@lervo/cli",
      version,
      repository: firstPublicationRepository,
      license: "Apache-2.0",
      registry: npmPublicRegistry,
    },
    reportDigest: `sha256:${"d".repeat(64)}`,
    receipt: { receiptDigest: `sha256:${"e".repeat(64)}` },
  };
  const licenseApproval = {
    schemaVersion: 1,
    evidenceType: "first_publication_license_approval",
    approvalId: "lic_fixture1",
    decision: "approve_public_distribution_license",
    approvedAt: "2026-08-21T02:30:00Z",
    approver: { kind: "user", id: "legal-owner@example.invalid" },
    target: {
      package: "@lervo/cli",
      repository: firstPublicationRepository,
      license: "Apache-2.0",
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
      package: "@lervo/cli",
      scopeOwner: { kind: "organization", name: "lervo" },
      postApplyReportDigest: postApplyReport.reportDigest,
    },
    basis: "operator_attestation",
  };
  const externalEvidenceReport = createFirstPublicationExternalEvidenceReport({
    postApplyReport,
    publicationAuthorization,
    licenseApproval,
    scopeConfirmation,
    firstPublicationApproval: approval,
    packageObservation,
    observedAt: "2026-08-21T02:59:00Z",
  });
  const packageManifest = {
    name: "@lervo/cli",
    version,
    license: "Apache-2.0",
    private: false,
    repository: {
      type: "git",
      url: `git+https://github.com/${firstPublicationRepository}.git`,
    },
    publishConfig: { access: "public", registry: npmPublicRegistry, provenance: true },
  };
  const releaseManifest = {
    artifact: {
      name: "@lervo/cli",
      version,
      license: "Apache-2.0",
      repository: `git+https://github.com/${firstPublicationRepository}.git`,
      registry: npmPublicRegistry,
      provenance: true,
      private: false,
      access: "public",
    },
  };
  const bootstrap = createFirstPublicationBootstrapAuthorization({
    publicationAuthorization,
    packageManifest,
    releaseManifest,
    externalEvidenceReport,
    packageObservation,
    observedAt: "2026-08-21T03:00:00Z",
  });
  const executionPlan = createFirstPublicationExecutionPlan({
    bootstrap,
    publicationAuthorization,
  });
  const armingDecision = {
    schemaVersion: 1,
    decisionId: armingDecisionId,
    decision: "authorize_first_publication_once",
    decidedAt: "2026-08-21T03:00:15Z",
    expiresAt: "2026-08-21T03:05:15Z",
    actor: { kind: "user", id: "release-operator@example.invalid" },
    target: {
      package: bootstrap.target.package,
      version: bootstrap.target.version,
      bootstrapDigest: bootstrap.bootstrapDigest,
      publicationAuthorizationDigest: publicationAuthorization.authorizationDigest,
      executionPlanDigest: executionPlan.executionPlanDigest,
    },
    confirmations: [...firstPublicationArmingConfirmations],
  };
  const armingAuthorization = createFirstPublicationArmingAuthorization({
    bootstrap,
    publicationAuthorization,
    decision: armingDecision,
    armedAt: "2026-08-21T03:00:30Z",
  });
  return {
    approval,
    armingAuthorization,
    armingDecision,
    artifact,
    bootstrap,
    externalEvidenceReport,
    executionPlan,
    licenseApproval,
    packageManifest,
    packageObservation,
    postApplyReport,
    publicationAuthorization,
    releaseManifest,
    scopeConfirmation,
    tarballContents,
  };
}
