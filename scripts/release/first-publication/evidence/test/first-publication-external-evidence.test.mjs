import assert from "node:assert/strict";
import { rm } from "node:fs/promises";

import { describe, it } from "vitest";

import {
  createFirstPublicationExternalEvidenceReport,
  validateFirstPublicationExternalEvidenceReport,
} from "../first-publication-external-evidence-report.mjs";
import { validateFirstPublicationExternalEvidenceReportDocument } from "../first-publication-external-evidence-reader.mjs";
import { canonicalDigest } from "../../../../shared/release-artifact-manifest.mjs";
import { createExternalEvidenceFixture } from "../../test/fixtures/first-publication-external-evidence.mjs";

function reportInput(fixture) {
  return {
    ...fixture.documents,
    packageObservation: fixture.packageObservation,
    observedAt: fixture.observedAt,
  };
}

describe("first-publication external requirement evidence report", () => {
  it("binds four independent requirements without arming publication", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      const report = createFirstPublicationExternalEvidenceReport(reportInput(fixture));
      assert.equal(report.status, "evidence_bound");
      assert.equal(report.activation, "not_implemented");
      assert.equal(report.arming, "not_armed");
      assert.deepEqual(report.target.scopeOwner, { kind: "organization", name: "lervo" });
      assert.equal(
        report.evidence.publicPackageAvailability.validUntil,
        "2026-08-21T03:10:00.000Z",
      );
      assert.equal(report.validity.validUntil, "2026-08-21T03:10:00.000Z");
      assert.deepEqual(report.requirements, [
        { id: "license_approval", status: "bound" },
        { id: "public_package_availability", status: "bound" },
        { id: "scope_control_confirmation", status: "bound" },
        { id: "first_publication_approval", status: "bound" },
      ]);
      assert.equal(report.limitations.scopeControlAuthority, "not_registry_verified");
      assert.equal(JSON.stringify(report).includes("legal-owner@example.invalid"), false);
      assert.equal(JSON.stringify(report).includes("npm-owner@example.invalid"), false);
      assert.equal(validateFirstPublicationExternalEvidenceReportDocument(report), report);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects license and scope documents bound to other local evidence", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      const licenseInput = reportInput(fixture);
      licenseInput.licenseApproval = structuredClone(licenseInput.licenseApproval);
      licenseInput.licenseApproval.target.postApplyReportDigest = `sha256:${"a".repeat(64)}`;
      assert.throws(() => createFirstPublicationExternalEvidenceReport(licenseInput), {
        code: "first_publication_external_evidence_license_approval_invalid",
      });
      const scopeInput = reportInput(fixture);
      scopeInput.scopeConfirmation = structuredClone(scopeInput.scopeConfirmation);
      scopeInput.scopeConfirmation.target.scopeOwner.name = "another";
      assert.throws(() => createFirstPublicationExternalEvidenceReport(scopeInput), {
        code: "first_publication_external_evidence_scope_confirmation_invalid",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects expired scope confirmation and a visible public package", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      const expired = reportInput(fixture);
      expired.scopeConfirmation = structuredClone(expired.scopeConfirmation);
      expired.scopeConfirmation.expiresAt = fixture.observedAt;
      assert.throws(() => createFirstPublicationExternalEvidenceReport(expired), {
        code: "first_publication_external_evidence_scope_confirmation_invalid",
      });
      const existing = reportInput(fixture);
      existing.packageObservation = {
        ...existing.packageObservation,
        state: "existing",
      };
      assert.throws(() => createFirstPublicationExternalEvidenceReport(existing), {
        code: "first_publication_external_evidence_package_not_available",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects an umbrella approval that selects another license", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      const input = reportInput(fixture);
      input.firstPublicationApproval = structuredClone(input.firstPublicationApproval);
      input.firstPublicationApproval.target.license = "MIT";
      assert.throws(() => createFirstPublicationExternalEvidenceReport(input), {
        code: "first_publication_external_evidence_target_mismatch",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a redigested report that claims activation", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      const input = reportInput(fixture);
      const forged = structuredClone(createFirstPublicationExternalEvidenceReport(input));
      forged.activation = "ready";
      const { evidenceReportDigest: _discarded, ...body } = forged;
      forged.evidenceReportDigest = canonicalDigest(body);
      assert.throws(() => validateFirstPublicationExternalEvidenceReport(forged, input), {
        code: "first_publication_external_evidence_report_invalid",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a redigested report that weakens its declared limitations", async () => {
    const fixture = await createExternalEvidenceFixture();
    try {
      const forged = structuredClone(
        createFirstPublicationExternalEvidenceReport(reportInput(fixture)),
      );
      forged.limitations.releaseArtifact = "verified";
      const { evidenceReportDigest: _discarded, ...body } = forged;
      forged.evidenceReportDigest = canonicalDigest(body);
      assert.throws(() => validateFirstPublicationExternalEvidenceReportDocument(forged), {
        code: "first_publication_external_evidence_report_invalid",
      });
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
