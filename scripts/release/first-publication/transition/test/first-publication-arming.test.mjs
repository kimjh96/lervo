import assert from "node:assert/strict";

import { describe, it } from "vitest";

import {
  createFirstPublicationArmingAuthorization,
  validateFirstPublicationArmingAuthorization,
  validateFirstPublicationArmingAuthorizationDocument,
} from "../first-publication-arming-authorization.mjs";
import { executeFirstPublicationBootstrap } from "../../shared/first-publication-execution.mjs";
import {
  createFirstPublicationReservation,
  firstPublicationReservationId,
  validateFirstPublicationReservation,
} from "../../shared/first-publication-reservation.mjs";
import { canonicalDigest } from "../../../../shared/release-artifact-manifest.mjs";
import { createFirstPublicationFixture } from "../../test/fixtures/first-publication.mjs";

function fixture() {
  return createFirstPublicationFixture({
    approvalId: "apr_arming01",
    armingDecisionId: "arm_arming01",
  });
}

function rearm(source) {
  const decision = structuredClone(source.armingDecision);
  decision.decisionId = "arm_arming02";
  decision.decidedAt = "2026-08-21T03:00:20Z";
  decision.expiresAt = "2026-08-21T03:05:10Z";
  return createFirstPublicationArmingAuthorization({
    bootstrap: source.bootstrap,
    publicationAuthorization: source.publicationAuthorization,
    decision,
    armedAt: "2026-08-21T03:00:40Z",
  });
}

describe("first-publication arming authorization", () => {
  it("binds one human decision to the exact bootstrap and execution plan", () => {
    const source = fixture();
    const authorization = source.armingAuthorization;
    assert.equal(authorization.status, "armed");
    assert.equal(authorization.binding.bootstrapDigest, source.bootstrap.bootstrapDigest);
    assert.equal(
      authorization.binding.executionPlanDigest,
      source.executionPlan.executionPlanDigest,
    );
    assert.equal(authorization.validity.validUntil, source.armingDecision.expiresAt);
    assert.equal(authorization.execution.consumption, "durable_reservation");
    assert.equal(authorization.execution.publisherEntryPoint, "not_exposed");
    assert.equal(JSON.stringify(authorization).includes(source.armingDecision.actor.id), false);
    assert.equal(validateFirstPublicationArmingAuthorizationDocument(authorization), authorization);
    assert.equal(
      validateFirstPublicationArmingAuthorization(authorization, {
        bootstrap: source.bootstrap,
        publicationAuthorization: source.publicationAuthorization,
        checkedAt: "2026-08-21T03:01:00Z",
      }),
      authorization,
    );
  });

  it("rejects a decision for another plan and a decision that already expired", () => {
    const source = fixture();
    const mismatched = structuredClone(source.armingDecision);
    mismatched.target.executionPlanDigest = `sha256:${"f".repeat(64)}`;
    assert.throws(
      () =>
        createFirstPublicationArmingAuthorization({
          bootstrap: source.bootstrap,
          publicationAuthorization: source.publicationAuthorization,
          decision: mismatched,
          armedAt: "2026-08-21T03:00:30Z",
        }),
      { code: "first_publication_arming_decision_invalid" },
    );

    const expired = structuredClone(source.armingDecision);
    expired.expiresAt = "2026-08-21T03:00:30Z";
    assert.throws(
      () =>
        createFirstPublicationArmingAuthorization({
          bootstrap: source.bootstrap,
          publicationAuthorization: source.publicationAuthorization,
          decision: expired,
          armedAt: "2026-08-21T03:00:30Z",
        }),
      { code: "first_publication_arming_decision_invalid" },
    );

    assert.throws(
      () =>
        createFirstPublicationArmingAuthorization({
          bootstrap: source.bootstrap,
          publicationAuthorization: source.publicationAuthorization,
          decision: source.armingDecision,
          armedAt: "2026-08-21T03:09:00Z",
        }),
      { code: "first_publication_arming_authorization_expired" },
    );
  });

  it("rejects a redigested document that exposes a publisher entry point", () => {
    const source = fixture();
    const forged = structuredClone(source.armingAuthorization);
    forged.execution.publisherEntryPoint = "available";
    const { armingAuthorizationDigest: _oldDigest, ...body } = forged;
    forged.armingAuthorizationDigest = canonicalDigest(body);
    assert.throws(() => validateFirstPublicationArmingAuthorizationDocument(forged), {
      code: "first_publication_arming_authorization_invalid",
    });

    const longLived = structuredClone(source.armingAuthorization);
    longLived.validity.validUntil = "2026-08-21T03:08:00Z";
    const { armingAuthorizationDigest: _discarded, ...longBody } = longLived;
    longLived.armingAuthorizationDigest = canonicalDigest(longBody);
    assert.throws(() => validateFirstPublicationArmingAuthorizationDocument(longLived), {
      code: "first_publication_arming_authorization_invalid",
    });
  });

  it("binds the authorization digest while keeping one reservation ID per bootstrap", () => {
    const source = fixture();
    const secondAuthorization = rearm(source);
    const first = createFirstPublicationReservation({
      bootstrap: source.bootstrap,
      armingAuthorization: source.armingAuthorization,
      publicationAuthorization: source.publicationAuthorization,
      reservedAt: "2026-08-21T03:01:00Z",
    });
    const second = createFirstPublicationReservation({
      bootstrap: source.bootstrap,
      armingAuthorization: secondAuthorization,
      publicationAuthorization: source.publicationAuthorization,
      reservedAt: "2026-08-21T03:01:00Z",
    });
    assert.equal(first.reservationId, firstPublicationReservationId(source.bootstrap));
    assert.equal(second.reservationId, first.reservationId);
    assert.notEqual(second.reservationDigest, first.reservationDigest);
    assert.equal(
      first.armingAuthorizationDigest,
      source.armingAuthorization.armingAuthorizationDigest,
    );

    const legacy = structuredClone(first);
    legacy.schemaVersion = 1;
    delete legacy.armingAuthorizationDigest;
    const { reservationDigest: _legacyDigest, ...legacyBody } = legacy;
    legacy.reservationDigest = canonicalDigest(legacyBody);
    assert.throws(
      () =>
        validateFirstPublicationReservation(legacy, {
          bootstrap: source.bootstrap,
          armingAuthorization: source.armingAuthorization,
          publicationAuthorization: source.publicationAuthorization,
        }),
      { code: "first_publication_reservation_invalid" },
    );
  });

  it("rejects missing authorization before preparing, observing, or reserving", async () => {
    const source = fixture();
    let downstreamCalls = 0;
    await assert.rejects(
      executeFirstPublicationBootstrap(
        {
          bootstrap: source.bootstrap,
          publicationAuthorization: source.publicationAuthorization,
          releaseDirectory: "/release",
        },
        {
          preparePublish: async () => {
            downstreamCalls += 1;
          },
          observePackage: async () => {
            downstreamCalls += 1;
          },
          reservationStore: {
            reserve: async () => {
              downstreamCalls += 1;
            },
            complete: async () => {},
            abort: async () => {},
            markUnknown: async () => {},
          },
          publish: async () => {
            downstreamCalls += 1;
          },
          clock: () => "2026-08-21T03:01:00Z",
        },
      ),
      { code: "first_publication_arming_authorization_invalid" },
    );
    assert.equal(downstreamCalls, 0);
  });

  it("rechecks expiry after the public package observation and before reservation", async () => {
    const source = fixture();
    const calls = [];
    const times = ["2026-08-21T03:05:14Z", "2026-08-21T03:05:15Z"];
    await assert.rejects(
      executeFirstPublicationBootstrap(
        {
          bootstrap: source.bootstrap,
          armingAuthorization: source.armingAuthorization,
          publicationAuthorization: source.publicationAuthorization,
          releaseDirectory: "/release",
        },
        {
          observePackage: async () => {
            calls.push("observe");
            return {
              schemaVersion: 1,
              source: "npm_public_registry",
              state: "not_found",
              package: "@lervo/cli",
            };
          },
          reservationStore: {
            reserve: async () => {
              calls.push("reserve");
            },
            complete: async () => {},
            abort: async () => {},
            markUnknown: async () => {},
          },
          publish: async () => {
            calls.push("publish");
          },
          clock: () => times.shift(),
        },
      ),
      { code: "first_publication_arming_authorization_invalid" },
    );
    assert.deepEqual(calls, ["observe"]);
  });
});
