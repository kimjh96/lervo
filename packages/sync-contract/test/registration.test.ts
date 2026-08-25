import { defaultProjectDataPolicy, validateSchema } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { planProjectRegistration } from "../src/index.js";
import { destinationId, manifest, registration } from "./fixture.js";

describe("Hub project registration contract", () => {
  it("requires explicit Hub sync and keeps identity stable across metadata refreshes", () => {
    expect(() =>
      registration({
        ...manifest(),
        dataPolicy: defaultProjectDataPolicy,
      }),
    ).toThrowError(expect.objectContaining({ code: "project_sync_disabled" }));

    const original = registration(manifest());
    const first = planProjectRegistration({
      current: null,
      request: original,
      acceptedAt: "2026-08-19T01:00:01.000Z",
    });
    expect(first.response).toMatchObject({
      status: "registered",
      cursor: { seq: 0, eventHash: null },
    });

    const retry = registration(manifest(), "2026-08-19T01:00:02.000Z");
    const unchanged = planProjectRegistration({
      current: first.state,
      request: retry,
      acceptedAt: "2026-08-19T01:00:03.000Z",
    });
    expect(retry.registrationId).toBe(original.registrationId);
    expect(unchanged.response.status).toBe("unchanged");

    const renamed = registration(manifest(undefined, { name: "Renamed project" }));
    const updated = planProjectRegistration({
      current: unchanged.state,
      request: renamed,
      acceptedAt: "2026-08-19T01:00:04.000Z",
    });
    expect(renamed.registrationId).toBe(original.registrationId);
    expect(renamed.projectManifestHash).not.toBe(original.projectManifestHash);
    expect(updated.response.status).toBe("updated");

    const differentIdentity = registration(
      manifest(undefined, {
        createdAt: "2026-08-19T00:00:01.000Z",
      }),
    );
    expect(() =>
      planProjectRegistration({
        current: updated.state,
        request: differentIdentity,
        acceptedAt: "2026-08-19T01:00:05.000Z",
      }),
    ).toThrowError(expect.objectContaining({ code: "registration_identity_conflict" }));
  });

  it("rejects transport fields outside the registration and acknowledgement schemas", () => {
    const request = registration(manifest());
    expect(
      validateSchema("projectRegistrationRequest", {
        ...request,
        credential: "must-not-enter-contract",
      }).valid,
    ).toBe(false);
    expect(
      validateSchema("eventSyncAcknowledgement", {
        schemaVersion: 1,
        batchId: `hsb_${"a".repeat(64)}`,
        registrationId: request.registrationId,
        projectId: request.project.projectId,
        destinationId,
        status: "accepted",
        acceptedEventIds: ["evt_sync_schema_01"],
        insertedCount: 1,
        duplicateCount: 0,
        cursor: { seq: 1, eventHash: null },
        bufferedEventCount: 0,
        acknowledgedAt: "2026-08-19T01:00:00.000Z",
      }).valid,
    ).toBe(false);
  });
});
