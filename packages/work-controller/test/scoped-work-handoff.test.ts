import { expect, it } from "vitest";
import type {
  ScopedWorkHandoffV1,
  ScopedWorkHandoffAcceptanceV1,
} from "@lervo/application-contract";
import {
  assertScopedWorkHandoff,
  assertScopedHandoffRequest,
  assertScopedHandoffAcceptance,
  scopedHandoffFields,
} from "../src/scoped-work-handoff.js";
import { operatingContractHash } from "../src/operating-mandate-admission.js";

function fixture() {
  const hash = operatingContractHash("exact source");
  const request = {
    objective: "Return the verified infrastructure constraint.",
    deliverables: ["The supported constraint with evidence"],
    acceptanceCriteria: ["Preserve both repository authorities"],
    evidenceArtifactHashes: [hash],
  };
  const party = (letter: string) => ({
    projectId: "prj_" + letter.repeat(16),
    teamId: "team_" + letter.repeat(8),
    workstreamId: "wks_" + letter.repeat(24),
    workstreamRevision: 1,
    ownerAgentId: "agt_" + letter.repeat(24),
    mandateHash: hash,
  });
  const offer: ScopedWorkHandoffV1 = {
    schemaVersion: 1,
    kind: "work.scoped_handoff",
    purpose: "team_support",
    source: party("a"),
    recipient: party("b"),
    sourceSnapshotHash: hash,
    recipientSnapshotHash: hash,
    requestArtifactHash: operatingContractHash(request),
    acceptanceHash: operatingContractHash(request.acceptanceCriteria),
    expiresAt: "2026-09-12T12:00:00.000Z",
    rationaleArtifactHash: hash,
  };
  const acceptance: ScopedWorkHandoffAcceptanceV1 = {
    schemaVersion: 1,
    kind: "work.scoped_handoff_acceptance",
    handoffHash: operatingContractHash(offer),
    recipient: offer.recipient,
    sourceOfferEventId: "evt_" + "a".repeat(32),
    sourceOfferEventHash: hash,
    recipientSnapshotHash: hash,
    acceptedAt: "2026-09-12T11:00:00.000Z",
    rationaleArtifactHash: hash,
  };
  return { offer, acceptance, request };
}

it("preserves distinct project owners and exact successor acceptance without acquiring leases", () => {
  const { offer, acceptance, request } = fixture();
  assertScopedHandoffRequest(request, offer);
  assertScopedHandoffAcceptance(acceptance, offer);
  expect(scopedHandoffFields(offer, "product-owner", "claude", offer.expiresAt)).toMatchObject({
    provider: "claude",
    actionKind: "request_team_support",
    addedAssignments: 0,
    addedWorkers: 0,
    concurrentAttempts: 0,
    expectedPaths: [],
  });
  expect(() =>
    assertScopedWorkHandoff({ ...offer, leaseId: "lse_foreign" } as ScopedWorkHandoffV1),
  ).toThrow(/without lease/iu);
  expect(() => assertScopedWorkHandoff({ ...offer, recipient: offer.source })).toThrow();
  expect(() =>
    assertScopedHandoffRequest({ ...request, acceptanceCriteria: ["weaker acceptance"] }, offer),
  ).toThrow();
  expect(() =>
    assertScopedHandoffAcceptance(
      { ...acceptance, recipient: { ...acceptance.recipient, workstreamRevision: 2 } },
      offer,
    ),
  ).toThrow();
  expect(() =>
    assertScopedHandoffAcceptance({ ...acceptance, acceptedAt: offer.expiresAt }, offer),
  ).toThrow();
});
