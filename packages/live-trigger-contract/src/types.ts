import type {
  AssignmentRoutineRequestV1,
  AssignmentRoutineTemplateV1,
} from "@lervo/application-contract";

export interface LiveTriggerAdapterDescriptorV1 {
  schemaVersion: 1;
  adapterId: string;
  adapterVersion: string;
  descriptorHash: string;
  authentication: "hmac_sha256";
  replayProtection: "source_event_key";
  externalIdentifiers: "hashed_only";
  capabilities: ["assignment_routine.invoke"];
}

export interface LiveWebhookAuthorizationV1 {
  schemaVersion: 1;
  kind: "lervo_live_webhook_authorization";
  adapterId: string;
  adapterVersion: string;
  projectId: string;
  workstreamId: string;
  sourceId: string;
  credentialId: string;
  acceptedEventTypes: string[];
  validFrom: string;
  expiresAt: string;
  maximumAcceptedTriggers: number;
  routine: AssignmentRoutineTemplateV1;
}

export interface AuthenticatedLiveTriggerObservationV1 {
  schemaVersion: 1;
  kind: "authenticated_webhook";
  descriptor: LiveTriggerAdapterDescriptorV1;
  sourceId: string;
  credentialId: string;
  eventType: string;
  sourceEventKeyHash: string;
  requestContentHash: string;
  authenticationReceiptHash: string;
  occurredAt: string;
  authenticatedAt: string;
}

export type LiveTriggerAdmissionBlockedReasonV1 =
  | "adapter_mismatch"
  | "authorization_expired"
  | "authorization_not_yet_valid"
  | "credential_mismatch"
  | "event_time_invalid"
  | "event_type_denied"
  | "project_mismatch"
  | "source_mismatch"
  | "workstream_mismatch";

export interface LiveTriggerAdmissionPlanV1 {
  schemaVersion: 1;
  planId: string;
  status: "ready" | "blocked";
  projectId: string;
  workstreamId: string;
  adapterId: string;
  adapterVersion: string;
  descriptorHash: string;
  sourceId: string;
  sourceEventKeyHash: string;
  requestContentHash: string;
  authenticationReceiptHash: string;
  authorizationId: string;
  authorizationHash: string;
  routineId: string;
  templateVersion: string;
  templateHash: string;
  invocationFingerprintHash: string;
  maximumAcceptedTriggers: number;
  admittedAt: string;
  blockedReasons: LiveTriggerAdmissionBlockedReasonV1[];
  request: AssignmentRoutineRequestV1;
}

export interface LiveTriggerCompletionV1 {
  schemaVersion: 1;
  planId: string;
  invocationId: string;
  disposition: "materialized" | "resumed" | "already_materialized" | "skipped" | "coalesced";
  assignmentIds: string[];
  completedAt: string;
}

export type LiveTriggerReservationDecisionV1 =
  | { status: "reserved"; reservationId: string; recovery: false }
  | { status: "recoverable"; reservationId: string; recovery: true }
  | { status: "current"; completion: LiveTriggerCompletionV1 }
  | { status: "in_progress" }
  | { status: "idempotency_conflict" }
  | { status: "budget_exhausted" }
  | { status: "capacity_exhausted" };

export interface LiveTriggerReservationStoreV1 {
  reserve(plan: LiveTriggerAdmissionPlanV1): Promise<LiveTriggerReservationDecisionV1>;
  complete(input: { reservationId: string; completion: LiveTriggerCompletionV1 }): Promise<void>;
  requireRecovery(input: { reservationId: string; failedAt: string }): Promise<void>;
  pruneCompleted(input: { before: string; limit: number }): Promise<number>;
  recoverUnfinished(input: { before: string; limit: number }): Promise<number>;
  close(): Promise<void>;
}

export class LiveTriggerContractError extends Error {
  constructor(
    readonly code:
      | "authorization_invalid"
      | "descriptor_invalid"
      | "observation_invalid"
      | "plan_blocked"
      | "store_evidence_invalid",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LiveTriggerContractError";
  }
}
