import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  createFirstPublicationReconciliationReport,
  validateFirstPublicationReconciliationReport,
} from "../lib/first-publication-reconciliation.mjs";
import { createFirstPublicationReservation } from
  "../lib/first-publication-reservation.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import { createFirstPublicationFixture } from "./fixtures/first-publication.mjs";

function evidence(observationOverrides = {}) {
  const source = createFirstPublicationFixture();
  const reservation = createFirstPublicationReservation({
    bootstrap: source.bootstrap,
    armingAuthorization: source.armingAuthorization,
    publicationAuthorization: source.publicationAuthorization,
    reservedAt: "2026-08-21T03:01:00Z",
  });
  return {
    ...source,
    reservation,
    terminal: {
      reservationId: reservation.reservationId,
      reservationDigest: reservation.reservationDigest,
      state: "publication_unknown",
      retry: "forbidden",
    },
    npmObservation: {
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
      ...observationOverrides,
    },
    observedAt: "2026-08-21T03:10:00Z",
  };
}

describe("first-publication unknown outcome reconciliation", () => {
  it("reports an exact public version and dist-tag without changing retry authority", () => {
    const input = evidence();
    const report = createFirstPublicationReconciliationReport(input);
    assert.equal(report.outcome, "published");
    assert.deepEqual(report.checks.map(({ status }) => status), ["matched", "matched"]);
    assert.equal(report.binding.terminalRecordDigest, canonicalDigest(input.terminal));
    assert.deepEqual(report.disposition, {
      reservation: "unchanged",
      terminal: "unchanged",
      publication: "not_attempted",
      externalSettings: "not_changed",
    });
    assert.ok(report.limitations.includes("no_automatic_retry_authority"));
    assert.ok(report.limitations.includes("does_not_complete_transition"));
    validateFirstPublicationReconciliationReport(report, input);
  });

  it("distinguishes a version and target tag that are both not observed", () => {
    const input = evidence({
      versionMetadata: { state: "not_found" },
      distTagValue: { state: "not_found" },
    });
    const report = createFirstPublicationReconciliationReport(input);
    assert.equal(report.outcome, "not_observed");
    assert.deepEqual(report.checks.map(({ status }) => status), [
      "not_observed", "not_observed",
    ]);
    assert.equal(report.disposition.terminal, "unchanged");
  });

  it.each([
    ["mismatched release", {
      versionMetadata: {
        state: "found",
        registryIntegrity: `sha512-${"A".repeat(86)}==`,
        registryShasum: "1".repeat(40),
      },
    }],
    ["version without the target tag", { distTagValue: { state: "not_found" } }],
    ["tag without version metadata", {
      versionMetadata: { state: "not_found" },
      distTagValue: { state: "found", version: "0.1.0" },
    }],
  ])("keeps an inconsistent %s outcome unknown", (_name, overrides) => {
    assert.equal(createFirstPublicationReconciliationReport(evidence(overrides)).outcome, "unknown");
  });

  it("keeps an unavailable public registry outcome unknown", () => {
    const input = evidence();
    input.npmObservation = {
      schemaVersion: 1,
      source: "npm_public_registry_reconciliation",
      state: "unavailable",
      package: input.bootstrap.target.package,
      version: input.bootstrap.target.version,
      distTag: input.bootstrap.target.distTag,
      reason: "registry_unavailable",
    };
    const report = createFirstPublicationReconciliationReport(input);
    assert.equal(report.outcome, "unknown");
    assert.deepEqual(report.checks.flatMap(({ reasons }) => reasons), [
      "registry_unavailable", "registry_unavailable",
    ]);
  });

  it("requires the exact unknown terminal and an observation after reservation", () => {
    const published = evidence();
    published.terminal = {
      reservationId: published.reservation.reservationId,
      reservationDigest: published.reservation.reservationDigest,
      state: "published",
      executionReceiptDigest: `sha256:${"a".repeat(64)}`,
    };
    assert.throws(() => createFirstPublicationReconciliationReport(published), {
      code: "first_publication_reconciliation_invalid",
    });
    const early = evidence();
    early.observedAt = "2026-08-21T03:00:59Z";
    assert.throws(() => createFirstPublicationReconciliationReport(early), {
      code: "first_publication_reconciliation_invalid",
    });
  });

  it("rejects a redigested report that promotes an unknown result", () => {
    const input = evidence({ distTagValue: { state: "not_found" } });
    const report = createFirstPublicationReconciliationReport(input);
    const changed = structuredClone(report);
    changed.outcome = "published";
    const { reconciliationReportDigest: _old, ...body } = changed;
    changed.reconciliationReportDigest = canonicalDigest(body);
    assert.throws(() => validateFirstPublicationReconciliationReport(changed, input), {
      code: "first_publication_reconciliation_invalid",
    });
  });
});
