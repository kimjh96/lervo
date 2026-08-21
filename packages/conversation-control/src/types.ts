import type { HubCommandReview } from "@lervo/hub-control";
import type { ConversationResponder } from "@lervo/interaction";
import type { ConversationInboundEvent, WritingContract } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { WritingSemanticEvaluator } from "@lervo/writing";

export type ConversationControlOperation = "command_status" | "approval_review";

export type ParsedConversationControlCommand =
  | { operation: ConversationControlOperation; deliveryId: string }
  | { operation: "deliberation_start"; policyId: string; topic: string }
  | { operation: "deliberation_status"; deliberationId: string };

export type ConversationDeliberationStatus =
  | "running"
  | "interrupted"
  | "converged"
  | "no_consensus"
  | "failed";

export interface ConversationDeliberationSummary {
  deliberationId: string;
  status: ConversationDeliberationStatus;
  artifactCount: number;
  nextAction: "wait" | "resume" | "none";
}

export interface ConversationDeliberationPort {
  start(input: {
    event: ConversationInboundEvent;
    policyId: string;
    topic: string;
    requestedAt: string;
  }): Promise<ConversationDeliberationSummary>;
  inspect(input: {
    event: ConversationInboundEvent;
    deliberationId: string;
    inspectedAt: string;
  }): Promise<ConversationDeliberationSummary>;
}

export interface ConversationHubControlPort {
  inspect(input: {
    event: ConversationInboundEvent;
    operation: ConversationControlOperation;
    deliveryId: string;
    inspectedAt: string;
  }): Promise<{
    review: HubCommandReview;
    reviewUrl: string | null;
  }>;
}

export interface ConversationControlResponderOptions {
  artifactStore: ArtifactStore;
  control: ConversationHubControlPort;
  deliberations?: ConversationDeliberationPort;
  writingContract: WritingContract;
  semanticEvaluator: WritingSemanticEvaluator;
  now?: () => Date;
}

export type ConversationControlResponderPort = ConversationResponder;

export class ConversationControlError extends Error {
  constructor(
    readonly code:
      | "control_access_denied"
      | "control_command_invalid"
      | "control_source_failed"
      | "deliberation_source_failed"
      | "message_artifact_invalid"
      | "writing_publication_blocked",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversationControlError";
  }
}
