import type {
  ScopedWorkHandoffV1,
  ScopedWorkHandoffAcceptanceV1,
  ScopedWorkHandoffRequestV1,
  WorkHandoffPartyV1,
} from "@lervo/application-contract";
import { operatingContractHash } from "./operating-mandate-admission.js";
import { operatingHashPattern, operatingTime } from "./operating-contract-validation.js";

function validParty(party: WorkHandoffPartyV1): boolean {
  return (
    party !== null &&
    typeof party === "object" &&
    Object.keys(party).length === 6 &&
    /^prj_[a-f0-9]{16}$/u.test(party.projectId) &&
    /^team_[a-zA-Z0-9_-]{8,64}$/u.test(party.teamId) &&
    /^wks_[a-f0-9]{24}$/u.test(party.workstreamId) &&
    Number.isSafeInteger(party.workstreamRevision) &&
    party.workstreamRevision > 0 &&
    /^agt_[a-f0-9]{24}$/u.test(party.ownerAgentId) &&
    operatingHashPattern.test(party.mandateHash)
  );
}

export function assertScopedWorkHandoff(offer: ScopedWorkHandoffV1): void {
  if (
    offer === null ||
    typeof offer !== "object" ||
    Object.keys(offer).length !== 11 ||
    offer.schemaVersion !== 1 ||
    offer.kind !== "work.scoped_handoff" ||
    !["team_support", "central_escalation"].includes(offer.purpose) ||
    !validParty(offer.source) ||
    !validParty(offer.recipient) ||
    offer.source.projectId === offer.recipient.projectId ||
    offer.source.workstreamId === offer.recipient.workstreamId ||
    offer.source.ownerAgentId === offer.recipient.ownerAgentId ||
    ![
      offer.sourceSnapshotHash,
      offer.recipientSnapshotHash,
      offer.requestArtifactHash,
      offer.acceptanceHash,
      offer.rationaleArtifactHash,
    ].every((value) => operatingHashPattern.test(value)) ||
    !operatingTime(offer.expiresAt)
  )
    throw new Error(
      "The scoped handoff must bind separate exact repository authorities without lease fields.",
    );
}

export function assertScopedHandoffRequest(
  request: ScopedWorkHandoffRequestV1,
  offer: ScopedWorkHandoffV1,
): void {
  assertScopedWorkHandoff(offer);
  if (
    !validScopedHandoffRequestShape(request) ||
    operatingContractHash(request) !== offer.requestArtifactHash ||
    operatingContractHash(request.acceptanceCriteria) !== offer.acceptanceHash
  )
    throw new Error(
      "The scoped handoff request differs from its exact outcome and acceptance contract.",
    );
}

/** Validates the model's request shape before any recipient or authority lookup. */
export function validScopedHandoffRequestShape(
  request: unknown,
): request is ScopedWorkHandoffRequestV1 {
  if (request === null || typeof request !== "object" || Array.isArray(request)) return false;
  const value = request as Record<string, unknown>;
  const texts = (items: unknown): items is string[] =>
    Array.isArray(items) &&
    items.length > 0 &&
    items.length <= 16 &&
    new Set(items).size === items.length &&
    items.every(
      (item) => typeof item === "string" && item.trim().length > 0 && item.length <= 2000,
    );
  return !(
    Object.keys(value).length !== 4 ||
    !Object.hasOwn(value, "objective") ||
    !Object.hasOwn(value, "deliverables") ||
    !Object.hasOwn(value, "acceptanceCriteria") ||
    !Object.hasOwn(value, "evidenceArtifactHashes") ||
    typeof value.objective !== "string" ||
    !value.objective.trim() ||
    value.objective.length > 4000 ||
    !texts(value.deliverables) ||
    !texts(value.acceptanceCriteria) ||
    !Array.isArray(value.evidenceArtifactHashes) ||
    value.evidenceArtifactHashes.length > 32 ||
    new Set(value.evidenceArtifactHashes).size !== value.evidenceArtifactHashes.length ||
    !value.evidenceArtifactHashes.every((hash) => operatingHashPattern.test(hash))
  );
}

export function assertScopedHandoffAcceptance(
  acceptance: ScopedWorkHandoffAcceptanceV1,
  offer: ScopedWorkHandoffV1,
): void {
  assertScopedWorkHandoff(offer);
  if (
    acceptance === null ||
    typeof acceptance !== "object" ||
    Object.keys(acceptance).length !== 9 ||
    acceptance.schemaVersion !== 1 ||
    acceptance.kind !== "work.scoped_handoff_acceptance" ||
    acceptance.handoffHash !== operatingContractHash(offer) ||
    !validParty(acceptance.recipient) ||
    operatingContractHash(acceptance.recipient) !== operatingContractHash(offer.recipient) ||
    acceptance.recipientSnapshotHash !== offer.recipientSnapshotHash ||
    !/^evt_[a-f0-9]{32}$/u.test(acceptance.sourceOfferEventId) ||
    !operatingHashPattern.test(acceptance.sourceOfferEventHash) ||
    !operatingHashPattern.test(acceptance.rationaleArtifactHash) ||
    !operatingTime(acceptance.acceptedAt) ||
    Date.parse(acceptance.acceptedAt) >= Date.parse(offer.expiresAt)
  )
    throw new Error("The successor acceptance differs from the exact offered scope or deadline.");
}

/** Pure effect scope. Repository adapters must still validate both canonical source observations. */
export function scopedHandoffFields(
  effect: ScopedWorkHandoffV1 | ScopedWorkHandoffAcceptanceV1,
  roleId: string,
  provider: string,
  deadline: string,
  offer?: ScopedWorkHandoffV1,
) {
  if (effect.kind === "work.scoped_handoff") assertScopedWorkHandoff(effect);
  else {
    if (offer === undefined) throw new Error("Acceptance requires its exact offer.");
    assertScopedHandoffAcceptance(effect, offer);
  }
  if (
    !/^[a-z][a-z0-9_.-]{0,127}$/u.test(roleId) ||
    !/^[a-z][a-z0-9_-]{0,31}$/u.test(provider) ||
    !operatingTime(deadline) ||
    Date.parse(deadline) >
      Date.parse(effect.kind === "work.scoped_handoff" ? effect.expiresAt : offer!.expiresAt)
  )
    throw new Error("The handoff effect role or deadline is invalid.");
  return {
    actionKind:
      effect.kind === "work.scoped_handoff"
        ? effect.purpose === "team_support"
          ? ("request_team_support" as const)
          : ("escalate" as const)
        : ("execute_as_owner" as const),
    effectContract:
      effect.kind === "work.scoped_handoff"
        ? ("work.scoped_handoff.v1" as const)
        : ("work.scoped_handoff_acceptance.v1" as const),
    effectHash: operatingContractHash(effect),
    responsibilityArtifactHash: operatingContractHash(effect),
    roleId,
    requiredCapabilities: [],
    expectedPaths: [],
    provider,
    addedWorkers: 0,
    addedAssignments: 0,
    concurrentAttempts: 0,
    attemptNumber: 1,
    reservedTokens: 1,
    deadline,
  };
}
