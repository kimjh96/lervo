import { expect, it } from "vitest";
import type { OperatingAdmissionSnapshotV1 } from "@lervo/application-contract";
import {
  assertSupervisionAdmissionAuthorityStable,
  finalizeSupervisionAdmission,
} from "../src/supervision-admission-finalization.js";

const initialTime = "2026-09-23T18:00:00.000Z";
const responsibilityHash = `sha256:${"a".repeat(64)}`;
const observation: OperatingAdmissionSnapshotV1 = {
  observedAt: initialTime,
  sourceRevisionDigest: responsibilityHash,
  graphHash: responsibilityHash,
  installedMandateHash: responsibilityHash,
  installationReviewHash: responsibilityHash,
  revocationCoordinate: "fixture.revocation",
  revoked: false,
  ancestryValid: true,
  historyValid: true,
  activeWorkers: 1,
  activeAttempts: 0,
  assignmentCount: 1,
  observedAggregateTokens: 0,
  reservedAggregateTokens: 0,
  liveResponsibilityLease: true,
  resourceAdmission: "within",
  effectAdmissionHash: responsibilityHash,
  effectMappings: [],
};
const source = {
  responsibilities: [{ assignmentId: "asn_fixture", binding: { responsibilityHash } }],
  assignments: [{ assignmentId: "asn_fixture", lease: { expiresAt: "2026-09-23T18:00:05.000Z" } }],
};

it("dates a source-stable admission after the final read and expires its lease at that time", () => {
  expect(
    finalizeSupervisionAdmission({
      observation,
      source,
      responsibilityArtifactHash: responsibilityHash,
      observedAt: "2026-09-23T18:00:04.000Z",
    }),
  ).toMatchObject({
    observedAt: "2026-09-23T18:00:04.000Z",
    liveResponsibilityLease: true,
  });
  expect(
    finalizeSupervisionAdmission({
      observation,
      source,
      responsibilityArtifactHash: responsibilityHash,
      observedAt: "2026-09-23T18:00:06.000Z",
    }),
  ).toMatchObject({
    observedAt: "2026-09-23T18:00:06.000Z",
    liveResponsibilityLease: false,
  });
});

it("never manufactures a live lease from missing binding or negative evidence", () => {
  expect(
    finalizeSupervisionAdmission({
      observation,
      source,
      responsibilityArtifactHash: `sha256:${"b".repeat(64)}`,
      observedAt: initialTime,
    }).liveResponsibilityLease,
  ).toBe(false);
  expect(
    finalizeSupervisionAdmission({
      observation: { ...observation, liveResponsibilityLease: false },
      source,
      responsibilityArtifactHash: responsibilityHash,
      observedAt: initialTime,
    }).liveResponsibilityLease,
  ).toBe(false);
});

it("rejects a changed or revoked authority after the final task-source read", () => {
  const authority = {
    installation: {
      latestEventId: "evt_initial",
      mandateHash: responsibilityHash,
      installationReviewHash: responsibilityHash,
      revoked: false,
    },
    source: { sourceRevisionDigest: responsibilityHash, workstreamRevision: 1, eligible: true },
  };
  expect(() => assertSupervisionAdmissionAuthorityStable(authority, authority)).not.toThrow();
  for (const changed of [
    {
      ...authority,
      installation: { ...authority.installation, latestEventId: "evt_revoked", revoked: true },
    },
    {
      ...authority,
      source: { ...authority.source, sourceRevisionDigest: `sha256:${"b".repeat(64)}` },
    },
    { ...authority, source: { ...authority.source, eligible: false } },
  ])
    expect(() => assertSupervisionAdmissionAuthorityStable(authority, changed)).toThrow(
      "authority changed",
    );
});
