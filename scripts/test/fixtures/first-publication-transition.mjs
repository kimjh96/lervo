import { createFirstPublicationExecutionReceipt } from "../../lib/first-publication-execution-receipt.mjs";
import { createFirstPublicationReconciliationReport } from "../../lib/first-publication-reconciliation.mjs";
import { createFirstPublicationReservation } from "../../lib/first-publication-reservation.mjs";
import { firstPublicationResolutionConfirmations } from "../../lib/first-publication-resolution-decision.mjs";
import { createFirstPublicationResolution } from "../../lib/first-publication-resolution.mjs";
import { stageOnlyWorkflowSteps } from "../../lib/first-publication-transition-policy.mjs";
import { canonicalDigest } from "../../lib/release-artifact-manifest.mjs";
import { createFirstPublicationFixture, firstPublicationRepository } from "./first-publication.mjs";

export function matchingFirstPublicationPublicObservation(source) {
  return {
    schemaVersion: 1,
    source: "npm_public_registry_reconciliation",
    state: "observed",
    package: source.bootstrap.target.package,
    version: source.bootstrap.target.version,
    distTag: source.bootstrap.target.distTag,
    versionMetadata: {
      state: "found",
      registryIntegrity: source.artifact.registryIntegrity,
      registryShasum: source.artifact.registryShasum,
    },
    distTagValue: { state: "found", version: source.bootstrap.target.version },
  };
}

export function matchingFirstPublicationNpmObservation() {
  return {
    schemaVersion: 1,
    source: "npm_trust",
    state: "configured",
    package: "@lervo/cli",
    provider: "github",
    repository: firstPublicationRepository,
    workflow: "cli-release-matrix.yml",
    environment: "npm-release",
    permissions: ["createStagedPackage"],
  };
}

export function matchingFirstPublicationGitHubObservation() {
  return {
    schemaVersion: 1,
    source: "github_environment",
    state: "observed",
    repository: firstPublicationRepository,
    environment: "npm-release",
    requiredReviewerCount: 1,
    preventSelfReview: true,
    tagPolicies: ["v*"],
  };
}

export function firstPublicationStageOnlyWorkflow() {
  return {
    jobs: {
      "publish-cli": {
        if: "github.event_name == 'workflow_dispatch' && github.ref_type == 'tag'",
        needs: "attested-cli",
        "runs-on": "ubuntu-latest",
        environment: "npm-release",
        permissions: { contents: "read", "id-token": "write" },
        steps: structuredClone(stageOnlyWorkflowSteps),
      },
    },
  };
}

export function createFirstPublicationTransitionFixture(options = {}) {
  const source = createFirstPublicationFixture(options);
  const reservation = createFirstPublicationReservation({
    ...source,
    reservedAt: "2026-08-21T03:01:00Z",
  });
  const publicationReport = {
    schemaVersion: 1,
    status: "published",
    authorizationDigest: source.publicationAuthorization.authorizationDigest,
    receipt: {
      registry: source.bootstrap.target.registry,
      package: source.bootstrap.target.package,
      version: source.bootstrap.target.version,
      distTag: source.bootstrap.target.distTag,
      registryIntegrity: source.artifact.registryIntegrity,
      registryShasum: source.artifact.registryShasum,
    },
  };
  const executionReceipt = createFirstPublicationExecutionReceipt({
    ...source,
    reservation,
    publicationReport,
    publishedAt: "2026-08-21T03:02:00Z",
  });
  const terminal = {
    reservationId: reservation.reservationId,
    reservationDigest: reservation.reservationDigest,
    state: "publication_unknown",
    retry: "forbidden",
  };
  const reconciliationReport = createFirstPublicationReconciliationReport({
    ...source,
    reservation,
    terminal,
    npmObservation: matchingFirstPublicationPublicObservation(source),
    observedAt: "2026-08-21T03:02:00Z",
  });
  const freshReconciliationReport = createFirstPublicationReconciliationReport({
    ...source,
    reservation,
    terminal,
    npmObservation: matchingFirstPublicationPublicObservation(source),
    observedAt: "2026-08-21T03:03:00Z",
  });
  const decision = {
    schemaVersion: 1,
    decisionId: "res_transition1",
    decision: "authorize_reconciled_publication_transition_review",
    decidedAt: "2026-08-21T03:02:30Z",
    expiresAt: "2026-08-21T03:10:00Z",
    actor: { kind: "user", id: "release-reviewer@example.invalid" },
    target: {
      package: source.bootstrap.target.package,
      version: source.bootstrap.target.version,
      bootstrapDigest: source.bootstrap.bootstrapDigest,
      reservationDigest: reservation.reservationDigest,
      terminalRecordDigest: canonicalDigest(terminal),
      reconciliationReportDigest: reconciliationReport.reconciliationReportDigest,
    },
    confirmations: [...firstPublicationResolutionConfirmations],
  };
  const resolution = createFirstPublicationResolution({
    ...source,
    reservation,
    terminal,
    reconciliationReport,
    freshReconciliationReport,
    decision,
    resolvedAt: "2026-08-21T03:03:00Z",
  });
  return {
    ...source,
    reservation,
    publicationReport,
    executionReceipt,
    terminal,
    reconciliationReport,
    freshReconciliationReport,
    decision,
    resolution,
    executionEvidence: { type: "execution_receipt", executionReceipt },
    resolutionEvidence: {
      type: "reconciliation_resolution",
      resolution,
      reconciliationReport,
      decision,
      reservation,
      terminal,
    },
  };
}

export function createFirstPublicationTransitionControls(source, publicationEvidence) {
  return {
    bootstrap: source.bootstrap,
    armingAuthorization: source.armingAuthorization,
    publicationAuthorization: source.publicationAuthorization,
    publicationEvidence,
    publicReleaseObservation: matchingFirstPublicationPublicObservation(source),
    workflow: firstPublicationStageOnlyWorkflow(),
    npmObservation: matchingFirstPublicationNpmObservation(),
    githubObservation: matchingFirstPublicationGitHubObservation(),
    observedAt: "2026-08-21T03:10:00Z",
  };
}
