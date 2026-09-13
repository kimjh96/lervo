/** Each party retains its own repository history, mandate and workstream. No lease crosses this boundary. */
export interface WorkHandoffPartyV1 {
  projectId: string;
  teamId: string;
  workstreamId: string;
  workstreamRevision: number;
  ownerAgentId: string;
  mandateHash: string;
}

export interface ScopedWorkHandoffRequestV1 {
  objective: string;
  deliverables: string[];
  acceptanceCriteria: string[];
  evidenceArtifactHashes: string[];
}

/** An offer requests a bounded outcome; it neither appoints its recipient nor transfers repository authority. */
export interface ScopedWorkHandoffV1 {
  schemaVersion: 1;
  kind: "work.scoped_handoff";
  purpose: "team_support" | "central_escalation";
  source: WorkHandoffPartyV1;
  recipient: WorkHandoffPartyV1;
  sourceSnapshotHash: string;
  recipientSnapshotHash: string;
  requestArtifactHash: string;
  acceptanceHash: string;
  expiresAt: string;
  rationaleArtifactHash: string;
}

/** The successor accepts only the offered outcome under its own exact canonical authority. */
export interface ScopedWorkHandoffAcceptanceV1 {
  schemaVersion: 1;
  kind: "work.scoped_handoff_acceptance";
  handoffHash: string;
  recipient: WorkHandoffPartyV1;
  sourceOfferEventId: string;
  sourceOfferEventHash: string;
  recipientSnapshotHash: string;
  acceptedAt: string;
  rationaleArtifactHash: string;
}
