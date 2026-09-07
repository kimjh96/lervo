import type { ConversationAdapter } from "@lervo/conversation-contract";
import type {
  ConversationContentReference,
  ConversationDeliveryReceipt,
  ConversationInboundEvent,
  ConversationOutboundMessage,
  ConversationParticipationDecision,
  ConversationParticipationPolicy,
  WritingPublicationPermit,
  WritingEvaluation,
} from "@lervo/schemas";
import type {
  WritingArtifactCoordinate,
  WritingEvaluationArtifactCoordinate,
} from "@lervo/writing";

export interface ParticipationWindow {
  latestResponseAt: string | null;
  responsesInLastHour: number;
}

export type ConversationInboundClaim =
  | {
      status: "claimed";
      leaseId: string;
      attemptCount: number;
    }
  | { status: "busy" }
  | {
      status: "completed";
      decision: ConversationParticipationDecision;
      outbound: ConversationOutboundMessage | null;
    };

export interface ConversationOutboundLease {
  leaseId: string;
  attemptCount: number;
  outbound: ConversationOutboundMessage;
}

export interface ConversationInteractionStore {
  claimInbound(input: {
    event: ConversationInboundEvent;
    policy: ConversationParticipationPolicy;
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
  }): Promise<ConversationInboundClaim>;

  getParticipationWindow(input: {
    policyId: string;
    conversationId: string;
    at: string;
  }): Promise<ParticipationWindow>;

  completeInbound(input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
    decision: ConversationParticipationDecision;
    outbound: ConversationOutboundMessage | null;
  }): Promise<void>;

  rescheduleInbound(input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
    failedAt: string;
    availableAt: string;
    failureCode: string;
  }): Promise<void>;

  claimOutbound(input: {
    integrationId: string;
    workerId: string;
    claimedAt: string;
    leaseDurationMs: number;
    limit: number;
  }): Promise<ConversationOutboundLease[]>;

  acknowledgeOutbound(input: {
    outboundId: string;
    leaseId: string;
    receipt: ConversationDeliveryReceipt;
  }): Promise<void>;

  rescheduleOutbound(input: {
    outboundId: string;
    leaseId: string;
    failedAt: string;
    availableAt: string;
    failureCode: string;
  }): Promise<void>;
}

export interface ConversationRelevanceEvaluator {
  evaluate(input: {
    event: ConversationInboundEvent;
    policy: ConversationParticipationPolicy;
  }): Promise<"relevant" | "not_relevant" | "unknown">;
}

export interface ConversationReplyCandidate {
  content: ConversationContentReference;
  publicationPermit: WritingPublicationPermit;
  publicationEvidence: {
    artifact: WritingArtifactCoordinate;
    evaluation: WritingEvaluation;
    evaluationArtifact: WritingEvaluationArtifactCoordinate;
  };
}

export interface ConversationResponder {
  respond(input: {
    event: ConversationInboundEvent;
    policy: ConversationParticipationPolicy;
    decision: ConversationParticipationDecision;
  }): Promise<ConversationReplyCandidate>;
}

export interface ConversationResponseActivity {
  start(): { stop(): void };
}

export interface ConversationPublicationVerifier {
  verify(input: {
    candidate: ConversationReplyCandidate;
    event: ConversationInboundEvent;
    policy: ConversationParticipationPolicy;
  }): Promise<void>;
}

export type HandleConversationEventResult =
  | {
      status: "completed" | "duplicate";
      decision: ConversationParticipationDecision;
      outbound: ConversationOutboundMessage | null;
    }
  | { status: "busy" }
  | {
      status: "retry_scheduled";
      failureCode: "response_generation_failed" | "publication_verification_failed";
      nextAttemptAt: string;
    };

export interface ConversationDeliveryCycleResult {
  status: "idle" | "processed";
  deliveredCount: number;
  retryScheduledCount: number;
}

export type { ConversationAdapter };
