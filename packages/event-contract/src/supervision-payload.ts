import { supervisionEventTypes, type EventType } from "@lervo/schemas";

const common = [
  "schemaVersion",
  "projectId",
  "workstreamId",
  "workstreamRevision",
  "supervisionId",
  "ownerAgentId",
  "mandateHash",
  "causationEventIds",
] as const;

export const supervisionPayloadAllowlists = {
  "work.supervision.mandate.installed": [
    ...common,
    "mandateId",
    "mandateVersion",
    "mandateArtifactHash",
    "installationReviewHash",
    "reviewerIdDigest",
    "predecessorMandateHash",
  ],
  "work.supervision.mandate.revoked": [
    ...common,
    "mandateId",
    "revocationCoordinateHash",
    "reviewerIdDigest",
  ],
  "work.supervision.bound": [
    ...common,
    "requestArtifactHash",
    "acceptanceArtifactHash",
    "expectedGraphHash",
  ],
  "work.responsibility.bound": [
    ...common,
    "assignmentId",
    "assignmentRevision",
    "executorAgentId",
    "reviewerAgentId",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "responsibilityArtifactHash",
    "predecessorBindingHash",
  ],
  "work.supervision.decision.recorded": [
    ...common,
    "decisionId",
    "sourceRevisionDigest",
    "actionKind",
    "planHash",
    "planArtifactHash",
    "rationaleArtifactHash",
    "policyReviewHash",
    "disposition",
  ],
  "work.supervision.decision.superseded": [
    ...common,
    "decisionId",
    "planHash",
    "inspectionArtifactHash",
    "sourceRevisionDigest",
  ],
  "work.supervision.owner_reasoning.interruption_reconciled": [
    ...common,
    "decisionId",
    "planHash",
    "managedRunId",
    "terminalEventId",
    "diagnosticArtifactHash",
  ],
  "work.supervision.effect.observed": [
    ...common,
    "decisionId",
    "planHash",
    "status",
    "effectEventIds",
  ],
  "work.supervision.readiness.failed": [
    ...common,
    "decisionId",
    "planHash",
    "assignmentId",
    "executorAgentId",
    "responsibilityArtifactHash",
    "sourceRevisionDigest",
    "readinessEvidenceHash",
    "reasonCode",
  ],
  "work.supervision.preflight.blocked": [
    ...common,
    "decisionId",
    "planHash",
    "effectContract",
    "sourceRevisionDigest",
    "inspectionArtifactHash",
    "failurePhase",
    "reasonCode",
  ],
  "work.supervision.preflight.resolved": [
    ...common,
    "blockedEventId",
    "blockedEventHash",
    "supersessionEventId",
    "supersessionEventHash",
    "sourceSnapshotEventId",
    "sourceSnapshotEventHash",
    "reviewArtifactHash",
    "reviewerIdDigest",
    "resolutionKind",
  ],
  "work.supervision.review.recorded": [
    ...common,
    "assignmentIds",
    "artifactHashes",
    "verificationEventIds",
    "acceptanceHash",
    "reviewerAgentId",
    "verdict",
  ],
  "work.supervision.escalation.recorded": [
    ...common,
    "escalationId",
    "recipientAgentId",
    "reasonCode",
    "evidenceEventIds",
    "decisionArtifactHash",
    "nextCheckAt",
  ],
  "work.supervision.handoff.offered": [
    ...common,
    "decisionId",
    "planHash",
    "handoffHash",
    "recipientProjectId",
    "recipientWorkstreamId",
    "recipientAgentId",
  ],
  "work.supervision.peer.observed": [
    ...common,
    "peerProjectId",
    "routeHash",
    "peerObservationHash",
  ],
  "work.supervision.handoff.accepted": [
    ...common,
    "decisionId",
    "planHash",
    "handoffHash",
    "sourceProjectId",
    "sourceWorkstreamId",
    "sourceOfferEventId",
    "sourceOfferEventHash",
    "acceptanceArtifactHash",
  ],
  "work.supervision.workspace.prepared": [
    ...common,
    "decisionId",
    "planHash",
    "assignmentId",
    "workspaceId",
    "provisionPlanHash",
    "workspaceArtifactHash",
    "coordinationEvidenceHash",
  ],
  "work.supervision.delivery.queued": [
    ...common,
    "decisionId",
    "planHash",
    "completionEventId",
    "resultArtifactHash",
    "candidateArtifactHash",
    "outboundArtifactHash",
  ],
  "work.supervision.delivery.observed": [
    ...common,
    "decisionId",
    "planHash",
    "outboundId",
    "attemptNumber",
    "status",
    "receiptArtifactHash",
    "reasonCode",
    "nextCheckAt",
  ],
} as const;

const HASH = /^sha256:[a-f0-9]{64}$/u;
const ID = /^[a-z][a-z0-9_.:-]{0,127}$/u;
const actions = [
  "allocate_existing",
  "execute_as_owner",
  "hire_worker",
  "revise_responsibility",
  "request_team_support",
  "dispatch",
  "inspect_uncertain_effect",
  "retry_attempt",
  "request_rework",
  "escalate",
  "publish_result",
];

export function validateSupervisionPayload(
  type: EventType,
  payload: Record<string, unknown>,
): void {
  if (!supervisionEventTypes.includes(type as (typeof supervisionEventTypes)[number])) return;
  const fields = supervisionPayloadAllowlists[type as keyof typeof supervisionPayloadAllowlists];
  if (
    Object.keys(payload).length !== fields.length ||
    !fields.every((key) => Object.hasOwn(payload, key))
  ) {
    throw new TypeError("The supervision event field set is invalid.");
  }
  for (const [key, value] of Object.entries(payload)) {
    let valid: boolean;
    if (
      [
        "schemaVersion",
        "workstreamRevision",
        "assignmentRevision",
        "mandateVersion",
        "attemptNumber",
      ].includes(key)
    ) {
      valid =
        Number.isSafeInteger(value) &&
        Number(value) >= 1 &&
        (key !== "schemaVersion" || value === 1);
    } else if (
      [
        "predecessorMandateHash",
        "predecessorBindingHash",
        "policyReviewHash",
        "receiptArtifactHash",
        "nextCheckAt",
      ].includes(key) &&
      value === null
    ) {
      valid = true;
    } else if (key.endsWith("Hash") || key.endsWith("Digest")) {
      valid = typeof value === "string" && HASH.test(value);
    } else if (key.endsWith("Ids") || key.endsWith("Hashes")) {
      valid =
        Array.isArray(value) &&
        value.length <= (key === "assignmentIds" ? 256 : 64) &&
        new Set(value).size === value.length &&
        value.every(
          (item) =>
            typeof item === "string" &&
            (key.endsWith("Hashes")
              ? HASH.test(item)
              : key === "assignmentIds"
                ? /^asn_[a-f0-9]{24}$/u.test(item)
                : /^evt_[a-f0-9]{32}$/u.test(item)),
        );
    } else if (key === "nextCheckAt") {
      valid = typeof value === "string" && value.length <= 32 && Number.isFinite(Date.parse(value));
    } else if (key === "roleVersion") {
      valid =
        typeof value === "string" &&
        value.length <= 100 &&
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value);
    } else {
      valid = typeof value === "string" && ID.test(value);
      if (key.endsWith("AgentId")) valid &&= /^agt_[a-f0-9]{24}$/u.test(String(value));
      if (key === "projectId") valid &&= /^prj_[a-f0-9]{16}$/u.test(String(value));
      if (key === "workstreamId") valid &&= /^wks_[a-f0-9]{24}$/u.test(String(value));
      if (key === "assignmentId") valid &&= /^asn_[a-f0-9]{24}$/u.test(String(value));
      if (key === "managedRunId") valid &&= /^run_[a-f0-9]{32}$/u.test(String(value));
      if (key === "terminalEventId") valid &&= /^evt_[a-f0-9]{32}$/u.test(String(value));
      if (["blockedEventId", "supersessionEventId", "sourceSnapshotEventId"].includes(key))
        valid &&= /^evt_[a-f0-9]{32}$/u.test(String(value));
      if (key === "resolutionKind")
        valid &&= ["reviewed_source_change", "reviewed_authority_change"].includes(String(value));
      if (key === "actionKind") valid &&= actions.includes(String(value));
      if (key === "disposition")
        valid &&= ["admitted", "blocked", "uncertain"].includes(String(value));
      if (key === "status")
        valid &&= (
          type === "work.supervision.delivery.observed"
            ? ["delivered", "failed"]
            : ["recorded", "effect_confirmed", "uncertain"]
        ).includes(String(value));
      if (key === "verdict") valid &&= ["accepted", "rework", "blocked"].includes(String(value));
      if (key === "failurePhase")
        valid &&= ["admission", "readiness", "authority"].includes(String(value));
    }
    if (!valid) throw new TypeError(`The supervision event coordinate ${key} is invalid.`);
  }
  if (payload.status === "effect_confirmed" && (payload.effectEventIds as unknown[]).length === 0) {
    throw new TypeError("A confirmed supervision effect requires evidence.");
  }
  if (
    type === "work.supervision.preflight.blocked" &&
    (payload.causationEventIds as unknown[]).length !== 1
  )
    throw new TypeError("A blocked supervision preflight requires one causal decision event.");
  if (
    type === "work.supervision.preflight.resolved" &&
    (payload.causationEventIds as unknown[]).join("\0") !==
      [payload.blockedEventId, payload.supersessionEventId, payload.sourceSnapshotEventId].join(
        "\0",
      )
  )
    throw new TypeError("A preflight resolution requires its exact causal events in order.");
  if (
    type === "work.supervision.delivery.observed" &&
    (Number(payload.attemptNumber) > 4 ||
      (payload.status === "delivered" &&
        (payload.receiptArtifactHash === null || payload.nextCheckAt !== null)) ||
      (payload.status === "failed" && payload.receiptArtifactHash !== null) ||
      (payload.attemptNumber === 4 && payload.nextCheckAt !== null))
  )
    throw new TypeError("The result delivery observation is inconsistent.");
}
