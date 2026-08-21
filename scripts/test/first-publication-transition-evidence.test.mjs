import assert from "node:assert/strict";

import { describe, it } from "vitest";

import { resolveFirstPublicationTransitionEvidence } from
  "../lib/first-publication-transition-evidence.mjs";
import { createFirstPublicationTransitionReport } from
  "../lib/first-publication-transition-policy.mjs";
import {
  createFirstPublicationTransitionReceipt,
  validateFirstPublicationTransitionReceipt,
} from "../lib/first-publication-transition.mjs";
import { canonicalDigest } from "../lib/release-artifact-manifest.mjs";
import {
  createFirstPublicationTransitionControls as controls,
  createFirstPublicationTransitionFixture as evidenceFixture,
  matchingFirstPublicationPublicObservation as matchingObservation,
} from "./fixtures/first-publication-transition.mjs";

describe("first-publication transition evidence union", () => {
  it("keeps evidence provenance distinct while converging on one completion meaning", () => {
    const source = evidenceFixture();
    const executionInput = controls(source, source.executionEvidence);
    const resolutionInput = controls(source, source.resolutionEvidence);
    const executionReceipt = createFirstPublicationTransitionReceipt({
      ...executionInput,
      completedAt: executionInput.observedAt,
    });
    const resolutionReceipt = createFirstPublicationTransitionReceipt({
      ...resolutionInput,
      completedAt: resolutionInput.observedAt,
    });
    assert.equal(executionReceipt.publicationEvidence.type, "execution_receipt");
    assert.equal(resolutionReceipt.publicationEvidence.type, "reconciliation_resolution");
    assert.notEqual(
      executionReceipt.publicationEvidence.digest,
      resolutionReceipt.publicationEvidence.digest,
    );
    assert.deepEqual(executionReceipt.bootstrap, resolutionReceipt.bootstrap);
    assert.deepEqual(executionReceipt.publicRelease, resolutionReceipt.publicRelease);
    const { reportDigest: _executionReport, ...executionTransition } =
      executionReceipt.transition;
    const { reportDigest: _resolutionReport, ...resolutionTransition } =
      resolutionReceipt.transition;
    assert.notEqual(_executionReport, _resolutionReport);
    assert.deepEqual(executionTransition, resolutionTransition);
    validateFirstPublicationTransitionReceipt(executionReceipt, executionInput);
    validateFirstPublicationTransitionReceipt(resolutionReceipt, resolutionInput);
  });

  it("requires the same fresh exact public release on both evidence paths", () => {
    const source = evidenceFixture();
    for (const publicationEvidence of [source.executionEvidence, source.resolutionEvidence]) {
      const input = controls(source, publicationEvidence);
      input.publicReleaseObservation = {
        ...input.publicReleaseObservation,
        versionMetadata: { state: "not_found" },
        distTagValue: { state: "not_found" },
      };
      const report = createFirstPublicationTransitionReport(input);
      assert.equal(report.status, "blocked");
      assert.equal(report.checks[0].id, "exact_public_release");
      assert.deepEqual(report.checks[0].reasons, [
        "target_version_not_observed", "target_dist_tag_not_observed",
      ]);
      assert.throws(() => createFirstPublicationTransitionReceipt({
        ...input,
        completedAt: input.observedAt,
      }), { code: "first_publication_transition_not_ready" });
    }
  });

  it("rejects a malformed public release observation instead of treating it as blocked", () => {
    const source = evidenceFixture();
    const input = controls(source, source.executionEvidence);
    input.publicReleaseObservation.unexpected = true;
    assert.throws(() => createFirstPublicationTransitionReport(input), {
      code: "first_publication_public_release_observation_invalid",
    });
  });

  it("rejects mixed, incomplete, and source-mismatched union members", () => {
    const source = evidenceFixture();
    assert.throws(() => resolveFirstPublicationTransitionEvidence({
      ...source.executionEvidence,
      resolution: source.resolutionEvidence.resolution,
    }, source), { code: "first_publication_transition_evidence_invalid" });
    assert.throws(() => resolveFirstPublicationTransitionEvidence({
      type: "reconciliation_resolution",
      resolution: source.resolutionEvidence.resolution,
    }, source), { code: "first_publication_transition_evidence_invalid" });
    const wrong = structuredClone(source.resolutionEvidence);
    wrong.terminal.reservationDigest = `sha256:${"a".repeat(64)}`;
    assert.throws(() => resolveFirstPublicationTransitionEvidence(wrong, source), {
      code: "first_publication_reconciliation_report_invalid",
    });
  });

  it("rejects a transition observation earlier than either evidence", () => {
    const source = evidenceFixture();
    for (const publicationEvidence of [source.executionEvidence, source.resolutionEvidence]) {
      const input = controls(source, publicationEvidence);
      input.observedAt = "2026-08-21T03:01:59Z";
      assert.throws(() => createFirstPublicationTransitionReport(input), {
        code: "first_publication_transition_input_invalid",
      });
    }
  });

  it("rejects legacy or redigested completion receipts", () => {
    const source = evidenceFixture();
    const input = controls(source, source.executionEvidence);
    const receipt = createFirstPublicationTransitionReceipt({
      ...input,
      completedAt: input.observedAt,
    });
    const legacy = structuredClone(receipt);
    legacy.schemaVersion = 1;
    const { transitionReceiptDigest: _legacy, ...legacyBody } = legacy;
    legacy.transitionReceiptDigest = canonicalDigest(legacyBody);
    assert.throws(() => validateFirstPublicationTransitionReceipt(legacy, input), {
      code: "first_publication_transition_receipt_invalid",
    });

    const promoted = structuredClone(receipt);
    promoted.publicationEvidence.basis = "execution_receipt_recovered";
    const { transitionReceiptDigest: _old, ...body } = promoted;
    promoted.transitionReceiptDigest = canonicalDigest(body);
    assert.throws(() => validateFirstPublicationTransitionReceipt(promoted, input), {
      code: "first_publication_transition_receipt_invalid",
    });
  });
});
