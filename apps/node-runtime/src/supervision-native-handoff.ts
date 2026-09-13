import type {
  ScopedWorkHandoffV1,
  ScopedWorkHandoffAcceptanceV1,
  ScopedWorkHandoffRequestV1,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import {
  assertScopedHandoffRequest,
  assertScopedHandoffAcceptance,
  operatingContractHash,
  scopedHandoffFields,
} from "@lervo/work-controller";
import type { NativeOwnerPlanInput } from "./supervision-native-plans.js";

export async function nativeScopedHandoff(
  input: NativeOwnerPlanInput,
  details: Record<string, unknown>,
  rationaleArtifactHash: string,
) {
  const current = await readCurrentWorkstreamState(input.storage.paths.repositoryRoot);
  if (
    current === null ||
    operatingContractHash(current.snapshot) !== operatingContractHash(input.facts.workstream)
  )
    throw new Error("The native handoff goal changed during planning.");
  let effect: ScopedWorkHandoffV1 | ScopedWorkHandoffAcceptanceV1;
  let offer: ScopedWorkHandoffV1;
  let request: ScopedWorkHandoffRequestV1;
  if (input.decision.operation === "accept_team_support") {
    if (Object.keys(details).join(",") !== "handoffHash" || typeof details.handoffHash !== "string")
      throw new Error("Successor acceptance requires exactly one observed handoff hash.");
    const matches = input.facts.peers
      .filter((peer) => peer.status === "available")
      .flatMap((peer) => peer.incoming)
      .filter((item) => operatingContractHash(item.offer) === details.handoffHash);
    if (matches.length !== 1)
      throw new Error("The successor selected no unique observed source offer.");
    const incoming = matches[0]!;
    if (!input.facts.handoffs.pendingIncoming.includes(String(details.handoffHash)))
      throw new Error("The incoming scoped handoff is no longer pending acceptance.");
    offer = incoming.offer;
    request = incoming.request;
    if (
      offer.recipient.ownerAgentId !== input.base.ownerAgentId ||
      offer.recipientSnapshotHash !== current.contentHash
    )
      throw new Error("The source offer targets another successor or goal revision.");
    effect = {
      schemaVersion: 1,
      kind: "work.scoped_handoff_acceptance",
      handoffHash: operatingContractHash(offer),
      recipient: offer.recipient,
      recipientSnapshotHash: offer.recipientSnapshotHash,
      sourceOfferEventId: incoming.eventId,
      sourceOfferEventHash: incoming.eventHash,
      acceptedAt: input.now(),
      rationaleArtifactHash,
    };
    assertScopedHandoffAcceptance(effect, offer);
  } else {
    if (
      Object.keys(details).sort().join(",") !== "recipientProjectId,request" ||
      typeof details.recipientProjectId !== "string" ||
      details.request === null ||
      typeof details.request !== "object"
    )
      throw new Error(
        "A scoped request requires an observed recipient project and an exact outcome request.",
      );
    const peers = input.facts.peers.filter(
      (peer) =>
        peer.projectId === details.recipientProjectId &&
        peer.status === "available" &&
        peer.authority?.workstreamStatus === "active",
    );
    if (peers.length !== 1)
      throw new Error("No single available recipient authority was observed.");
    const peer = peers[0]!.authority!;
    request = details.request as ScopedWorkHandoffRequestV1;
    offer = {
      schemaVersion: 1,
      kind: "work.scoped_handoff",
      purpose: input.decision.operation === "escalate" ? "central_escalation" : "team_support",
      source: {
        projectId: input.base.projectId,
        teamId: input.base.teamId,
        workstreamId: input.base.workstreamId,
        workstreamRevision: current.snapshot.revision,
        ownerAgentId: input.base.ownerAgentId,
        mandateHash: input.base.mandateHash,
      },
      recipient: peer.party,
      sourceSnapshotHash: current.contentHash,
      recipientSnapshotHash: peer.workstreamSnapshotHash,
      requestArtifactHash: operatingContractHash(request),
      acceptanceHash: operatingContractHash(request.acceptanceCriteria),
      expiresAt: input.base.deadline,
      rationaleArtifactHash,
    };
    assertScopedHandoffRequest(request, offer);
    for (const hash of request.evidenceArtifactHashes)
      if (!(await input.storage.artifacts.has(`lervo-cas://sha256/${hash.slice(7)}`)))
        throw new Error("The requested handoff evidence is unavailable in the source repository.");
    effect = offer;
  }
  await input.storage.artifacts.put(canonicalJson(request));
  await input.storage.artifacts.put(canonicalJson(offer));
  return {
    effect,
    fields: scopedHandoffFields(
      effect,
      input.base.roleId,
      input.base.provider,
      new Date(
        Math.min(Date.parse(input.base.deadline), Date.parse(offer.expiresAt)),
      ).toISOString(),
      offer,
    ),
  };
}
