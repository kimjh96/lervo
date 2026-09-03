import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  createFirstPublicationExecutionPlan,
  firstPublicationCancellationBoundaries,
  firstPublicationExecutionSteps,
  validateFirstPublicationExecutionPlan,
} from "../first-publication-execution-plan.mjs";
import { canonicalDigest } from "../../../../shared/release-artifact-manifest.mjs";
import { createFirstPublicationFixture } from "../../test/fixtures/first-publication.mjs";

describe("first-publication execution plan", () => {
  it("shows the exact execution order without arming or changing state", () => {
    const source = createFirstPublicationFixture({ approvalId: "apr_plan0001" });
    const plan = createFirstPublicationExecutionPlan(source);
    assert.equal(plan.status, "not_armed");
    assert.equal(plan.activation, "not_implemented");
    assert.deepEqual(plan.sideEffects, {
      reservation: "not_created",
      publication: "not_attempted",
      externalSettings: "not_changed",
    });
    assert.deepEqual(plan.steps, firstPublicationExecutionSteps);
    assert.deepEqual(plan.cancellationBoundaries, firstPublicationCancellationBoundaries);
    assert.throws(() => firstPublicationExecutionSteps.push({}));
    assert.throws(() => {
      firstPublicationCancellationBoundaries[0].outcome = "silently_retry";
    });
    assert.deepEqual(
      plan.steps.map(({ id }) => id),
      [
        "validate_execution_inputs",
        "prepare_interactive_publisher",
        "reobserve_public_package_absence",
        "create_durable_reservation",
        "revalidate_release_artifact",
        "attempt_publication",
        "verify_registry_result",
        "record_terminal_result",
      ],
    );
    assert.equal(validateFirstPublicationExecutionPlan(plan, source), plan);
  });

  it("keeps a prior preflight advisory and requires every execution-time check again", () => {
    const source = createFirstPublicationFixture({ approvalId: "apr_plan0002" });
    const plan = createFirstPublicationExecutionPlan(source);
    assert.deepEqual(plan.preflight, {
      priorReportIsPermit: false,
      requiredAtExecution: [
        "bootstrap_freshness",
        "interactive_npm_readiness",
        "public_package_absence",
        "reservation_availability",
        "release_artifact_integrity",
      ],
    });
  });

  it("places the two exact human confirmations on opposite sides of publication", () => {
    const source = createFirstPublicationFixture({ approvalId: "apr_plan0003" });
    const plan = createFirstPublicationExecutionPlan(source);
    assert.deepEqual(plan.confirmations, [
      {
        id: "direct_publication_intent",
        timing: "before_reservation",
        phrase:
          "I will publish @lervo/cli@0.1.0 once with interactive 2FA and will not use a bypass token",
        declinedOutcome: "no_state_change",
      },
      {
        id: "second_factor_attestation",
        timing: "after_publication_attempt",
        phrase: "I completed the 2FA confirmation",
        declinedOutcome: "publication_unknown_retry_forbidden",
      },
    ]);
  });

  it("rejects another authorization and a redigested activation claim", () => {
    const source = createFirstPublicationFixture({ approvalId: "apr_plan0004" });
    const other = createFirstPublicationFixture({
      approvalId: "apr_plan0005",
      tarballContents: Buffer.from("another-release"),
    });
    assert.throws(
      () =>
        createFirstPublicationExecutionPlan({
          bootstrap: source.bootstrap,
          publicationAuthorization: other.publicationAuthorization,
        }),
      { code: "first_publication_execution_plan_authorization_mismatch" },
    );

    const plan = createFirstPublicationExecutionPlan(source);
    plan.status = "armed";
    plan.activation = "enabled";
    const body = structuredClone(plan);
    delete body.executionPlanDigest;
    plan.executionPlanDigest = canonicalDigest(body);
    assert.throws(() => validateFirstPublicationExecutionPlan(plan, source), {
      code: "first_publication_execution_plan_invalid",
    });
  });

  it("does not copy approver identity or turn readiness into 2FA proof", () => {
    const source = createFirstPublicationFixture({ approvalId: "apr_plan0006" });
    const serialized = JSON.stringify(createFirstPublicationExecutionPlan(source));
    assert.equal(serialized.includes("release-owner@example.invalid"), false);
    assert.equal(serialized.includes("2fa_proved"), false);
    assert.equal(serialized.includes("bypass_token_absent"), false);
  });
});
