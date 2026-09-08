import type { ConversationReplyCandidate } from "@lervo/interaction";
import type {
  ConversationOutboundMessage,
  ConversationTarget,
  RemoteCommandDeliveryAcknowledgement,
  RemoteCommandLease,
} from "@lervo/schemas";

export interface ConversationResultOrigin {
  deliveryId: string;
  commandId: string;
  sourceEventId: string;
  target: ConversationTarget;
  policyId: string;
  agentParticipantId: string;
  roleId: string;
  provider: "codex" | "claude";
  workstreamId: string;
  workstreamRevision: number;
  workstreamSnapshotContentHash: string;
  assignmentId: string | null;
  agentId: string | null;
  responseLanguage?: "en" | "ko";
  queuedAt: string;
}

export interface ConversationResultTerminal {
  acknowledgement: RemoteCommandDeliveryAcknowledgement;
  observedAt: string;
}

export interface ConversationResultRecord {
  origin: ConversationResultOrigin;
  terminal: ConversationResultTerminal;
  candidate: ConversationReplyCandidate | null;
  outbound: ConversationOutboundMessage | null;
}

export interface ConversationResultLease extends ConversationResultRecord {
  leaseId: string;
  attemptCount: number;
}

export interface ConversationResultStore {
  register(origin: ConversationResultOrigin): Promise<"created" | "duplicate">;
  observeTerminal(input: {
    lease: RemoteCommandLease;
    terminal: ConversationResultTerminal;
  }): Promise<"ready" | "duplicate" | "ignored">;
  claim(input: {
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): Promise<ConversationResultLease | null>;
  prepare(input: {
    deliveryId: string;
    leaseId: string;
    candidate: ConversationReplyCandidate;
    outbound: ConversationOutboundMessage;
  }): Promise<void>;
  acknowledge(input: { deliveryId: string; leaseId: string; deliveredAt: string }): Promise<void>;
  reschedule(input: {
    deliveryId: string;
    leaseId: string;
    failedAt: string;
    availableAt: string;
    failureCode: string;
  }): Promise<void>;
  close(): void;
}

export interface ConversationResultSource {
  read(input: {
    origin: ConversationResultOrigin;
    runId: string;
  }): Promise<{ runId: string; content: string }>;
}

export type ConversationResultCycleResult =
  | { status: "idle" }
  | { status: "delivered"; deliveryId: string; outboundId: string }
  | {
      status: "retry_scheduled";
      deliveryId: string;
      failureCode: string;
      nextAttemptAt: string;
    };
