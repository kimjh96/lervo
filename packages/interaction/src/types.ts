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

  renewInbound?(input: {
    eventId: string;
    policyId: string;
    roleId: string;
    leaseId: string;
    renewedAt: string;
    leaseDurationMs: number;
  }): Promise<void>;

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
    terminalFailure?: {
      failureCode: ConversationResponseFailureCode;
      failedAt: string;
    };
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

export interface ConversationTurnOwnershipEvaluator {
  owns(input: {
    event: ConversationInboundEvent;
    policy: ConversationParticipationPolicy;
  }): boolean;
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
    context?: {
      priorTurns: ReadonlyArray<{ role: "user" | "assistant"; text: string }>;
    };
  }): Promise<ConversationReplyCandidate>;
}

export type ConversationResponseFailureCode =
  | "response_generation_failed"
  | "response_context_unavailable"
  | "response_provider_unavailable"
  | "response_storage_unavailable"
  | "response_writing_blocked"
  | "response_evaluation_unavailable"
  | "response_execution_invalid"
  | "response_contract_invalid"
  | "publication_verification_failed";

export interface ConversationResponseFailure {
  failureCode: ConversationResponseFailureCode;
  retryable: boolean;
}

export interface ConversationResponseFailureClassifier {
  classify(error: unknown): ConversationResponseFailure;
}

export interface ConversationTerminalFailureResponder {
  respond(input: {
    event: ConversationInboundEvent;
    policy: ConversationParticipationPolicy;
    decision: ConversationParticipationDecision;
    failureCode: ConversationResponseFailureCode;
    attemptCount: number;
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
      failureCode: ConversationResponseFailureCode;
      nextAttemptAt: string;
    }
  | {
      status: "failed_terminal";
      decision: ConversationParticipationDecision;
      outbound: ConversationOutboundMessage;
      failureCode: ConversationResponseFailureCode;
      attemptCount: number;
    };

export interface ConversationDeliveryCycleResult {
  status: "idle" | "processed";
  deliveredCount: number;
  retryScheduledCount: number;
}

export type { ConversationAdapter };
