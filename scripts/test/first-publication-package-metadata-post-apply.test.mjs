import assert from "node:assert/strict";
import { access, mkdir, rm, writeFile } from "node:fs/promises";

import { describe, it } from "vitest";

import { validateFirstPublicationPackageMetadataApplyReceiptDocument } from
  "../lib/first-publication-package-metadata-apply-receipt.mjs";
import { readFirstPublicationPackageMetadataPostApplySources } from
  "../lib/first-publication-package-metadata-post-apply-sources.mjs";
import {
  createFirstPublicationPackageMetadataPostApplyReport,
  validateFirstPublicationPackageMetadataPostApplyReport,
} from "../lib/first-publication-package-metadata-post-apply-verification.mjs";
import { inspectFirstPublicationPackageMetadataTransactionState } from
  "../lib/first-publication-package-metadata-transaction-state.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import {
  applyMetadataFixture,
  createMetadataApplyFixture,
} from "./fixtures/first-publication-metadata-apply.mjs";

async function reportInput(fixture, applied) {
  const sources = await readFirstPublicationPackageMetadataPostApplySources(
    fixture.paths,
    applied.receiptPath,
  );
  return {
    ...sources,
    lockfile: fixture.lockfile,
    generatedReleaseManifest: fixture.derivedRelease.releaseManifest,
    transactionState: { status: "clear" },
  };
}

describe("first-publication package metadata post-apply report", () => {
  it("verifies current outputs while keeping external requirements separate", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const applied = await applyMetadataFixture(fixture);
      const report = createFirstPublicationPackageMetadataPostApplyReport(
        await reportInput(fixture, applied),
      );
      assert.equal(report.status, "verified");
      assert.equal(report.localStatus, "ready");
      assert.equal(report.localChecks.every(({ status }) => status === "ready"), true);
      assert.deepEqual(report.externalRequirements.map(({ id, status }) => ({ id, status })), [
        { id: "license_approval", status: "required" },
        { id: "public_package_availability", status: "required" },
        { id: "scope_control_confirmation", status: "required" },
        { id: "first_publication_approval", status: "required" },
      ]);
      assert.equal(report.limitations.receiptAuthenticity, "not_verified");
      assert.equal(report.sideEffects.publication, "not_attempted");
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a redigested receipt that changes its fixed claims", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const { receipt } = await applyMetadataFixture(fixture);
      const forged = structuredClone(receipt);
      forged.effects.approval = "created";
      const { receiptDigest: _discarded, ...body } = forged;
      forged.receiptDigest = canonicalDigest(body);
      assert.throws(
        () => validateFirstPublicationPackageMetadataApplyReceiptDocument(forged),
        { code: "first_publication_package_metadata_apply_receipt_invalid" },
      );
      const redirected = structuredClone(receipt);
      redirected.files[0].relativePath = "package.json";
      const { receiptDigest: _redirectedDigest, ...redirectedBody } = redirected;
      redirected.receiptDigest = canonicalDigest(redirectedBody);
      assert.throws(
        () => validateFirstPublicationPackageMetadataApplyReceiptDocument(redirected),
        { code: "first_publication_package_metadata_apply_receipt_invalid" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects current bytes that no longer match the receipt", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const applied = await applyMetadataFixture(fixture);
      await writeFile(fixture.paths.packageManifestPath, "{}\n");
      const input = await reportInput(fixture, applied);
      assert.throws(
        () => createFirstPublicationPackageMetadataPostApplyReport(input),
        { code: "first_publication_package_metadata_post_apply_source_mismatch" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("rejects a report redigested with a stronger activation claim", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      const applied = await applyMetadataFixture(fixture);
      const input = await reportInput(fixture, applied);
      const forged = structuredClone(createFirstPublicationPackageMetadataPostApplyReport(input));
      forged.activation = "ready";
      const { reportDigest: _discarded, ...body } = forged;
      forged.reportDigest = canonicalDigest(body);
      assert.throws(
        () => validateFirstPublicationPackageMetadataPostApplyReport(forged, input),
        { code: "first_publication_package_metadata_post_apply_report_invalid" },
      );
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("inspects pending transaction state without removing it", async () => {
    const fixture = await createMetadataApplyFixture();
    try {
      await mkdir(fixture.transactionRoot);
      await writeFile(`${fixture.transactionRoot}/kept`, "unchanged\n");
      assert.deepEqual(
        await inspectFirstPublicationPackageMetadataTransactionState(fixture.transactionRoot),
        { status: "recovery_required" },
      );
      await access(`${fixture.transactionRoot}/kept`);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
