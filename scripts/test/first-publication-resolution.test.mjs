import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  createFirstPublicationReconciliationReport,
} from "../lib/first-publication-reconciliation.mjs";
import {
  validateFirstPublicationReconciliationReportDocument,
  validateFirstPublicationReconciliationReportSources,
} from "../lib/first-publication-reconciliation-reader.mjs";
import { createFirstPublicationReservation } from
  "../lib/first-publication-reservation.mjs";
import { firstPublicationResolutionConfirmations } from
  "../lib/first-publication-resolution-decision.mjs";
import {
  createFirstPublicationResolution,
  validateFirstPublicationResolution,
  validateFirstPublicationResolutionDocument,
} from "../lib/first-publication-resolution.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import { createFirstPublicationFixture } from "./fixtures/first-publication.mjs";

function matchingObservation(source) {
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

function resolutionEvidence() {
  const source = createFirstPublicationFixture({ armingDecisionId: "arm_resolution1" });
  const reservation = createFirstPublicationReservation({
    ...source,
    reservedAt: "2026-08-21T03:01:00Z",
  });
  const terminal = {
    reservationId: reservation.reservationId,
    reservationDigest: reservation.reservationDigest,
    state: "publication_unknown",
    retry: "forbidden",
  };
  const common = { ...source, reservation, terminal };
  const reconciliationReport = createFirstPublicationReconciliationReport({
    ...common,
    npmObservation: matchingObservation(source),
    observedAt: "2026-08-21T03:02:00Z",
  });
  const freshReconciliationReport = createFirstPublicationReconciliationReport({
    ...common,
    npmObservation: matchingObservation(source),
    observedAt: "2026-08-21T03:03:00Z",
  });
  const decision = {
    schemaVersion: 1,
    decisionId: "res_fixture1",
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
  return {
    ...common,
    reconciliationReport,
    freshReconciliationReport,
    decision,
    resolvedAt: "2026-08-21T03:03:00Z",
  };
}

describe("first-publication reconciliation resolution", () => {
  it("binds reviewed and fresh published reports without recovering an execution receipt", () => {
    const evidence = resolutionEvidence();
    validateFirstPublicationReconciliationReportDocument(evidence.reconciliationReport);
    validateFirstPublicationReconciliationReportSources(
      evidence.reconciliationReport,
      evidence,
    );
    const resolution = createFirstPublicationResolution(evidence);
    assert.equal(resolution.status, "transition_review_eligible");
    assert.deepEqual(resolution.authority, {
      transitionReview: "eligible",
      transitionCompletion: "not_authorized",
      executionReceipt: "not_recovered",
      retry: "forbidden",
    });
    assert.deepEqual(resolution.preservedState, {
      terminal: "publication_unknown",
      terminalMutation: "forbidden",
    });
    assert.equal(JSON.stringify(resolution).includes("release-reviewer"), false);
    assert.equal(
      resolution.binding.reviewedReconciliationReportDigest,
      evidence.reconciliationReport.reconciliationReportDigest,
    );
    assert.equal(
      resolution.binding.freshReconciliationReportDigest,
      evidence.freshReconciliationReport.reconciliationReportDigest,
    );
    assert.deepEqual(
      resolution.freshReconciliationReport,
      evidence.freshReconciliationReport,
    );
    const { freshReconciliationReport: _embedded, ...sources } = evidence;
    validateFirstPublicationResolution(resolution, sources);
  });

  it("rejects not-observed reviewed or fresh reports", () => {
    const reviewed = resolutionEvidence();
    reviewed.reconciliationReport = createFirstPublicationReconciliationReport({
      ...reviewed,
      npmObservation: {
        schemaVersion: 1,
        source: "npm_public_registry_reconciliation",
        state: "observed",
        package: reviewed.bootstrap.target.package,
        version: reviewed.bootstrap.target.version,
        distTag: reviewed.bootstrap.target.distTag,
        versionMetadata: { state: "not_found" },
        distTagValue: { state: "not_found" },
      },
      observedAt: "2026-08-21T03:02:00Z",
    });
    assert.throws(() => createFirstPublicationResolution(reviewed), {
      code: "first_publication_resolution_fresh_observation_required",
    });

    const fresh = resolutionEvidence();
    fresh.freshReconciliationReport = reviewed.reconciliationReport;
    assert.throws(() => createFirstPublicationResolution(fresh), {
      code: "first_publication_resolution_fresh_observation_required",
    });
  });

  it("rejects a decision bound to another report or used after expiry", () => {
    const wrong = resolutionEvidence();
    wrong.decision.target.reconciliationReportDigest = `sha256:${"a".repeat(64)}`;
    assert.throws(() => createFirstPublicationResolution(wrong), {
      code: "first_publication_resolution_decision_invalid",
    });
    const expired = resolutionEvidence();
    expired.resolvedAt = "2026-08-21T03:10:00Z";
    assert.throws(() => createFirstPublicationResolution(expired), {
      code: "first_publication_resolution_decision_invalid",
    });
  });

  it("rejects a fresh observation older than the reviewed report", () => {
    const evidence = resolutionEvidence();
    evidence.freshReconciliationReport = createFirstPublicationReconciliationReport({
      ...evidence,
      npmObservation: matchingObservation(evidence),
      observedAt: "2026-08-21T03:01:30Z",
    });
    assert.throws(() => createFirstPublicationResolution(evidence), {
      code: "first_publication_resolution_fresh_observation_required",
    });
  });

  it("rejects redigested completion or recovered-receipt authority", () => {
    const evidence = resolutionEvidence();
    for (const authorityChange of [
      { transitionCompletion: "authorized" },
      { executionReceipt: "recovered" },
    ]) {
      const changed = structuredClone(createFirstPublicationResolution(evidence));
      Object.assign(changed.authority, authorityChange);
      const { resolutionDigest: _old, ...body } = changed;
      changed.resolutionDigest = canonicalDigest(body);
      assert.throws(() => validateFirstPublicationResolutionDocument(changed), {
        code: "first_publication_resolution_invalid",
      });
    }
  });

  it("rejects a redigested reconciliation report with an impossible outcome", () => {
    const evidence = resolutionEvidence();
    const changed = structuredClone(evidence.reconciliationReport);
    changed.outcome = "unknown";
    const { reconciliationReportDigest: _old, ...body } = changed;
    changed.reconciliationReportDigest = canonicalDigest(body);
    assert.throws(() => validateFirstPublicationReconciliationReportDocument(changed), {
      code: "first_publication_reconciliation_report_invalid",
    });
  });
});
