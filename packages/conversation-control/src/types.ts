import type { HubCommandReview } from "@lervo/hub-control";
import type { ConversationResponder } from "@lervo/interaction";
import type { ConversationInboundEvent, WritingContract } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { WritingSemanticEvaluator } from "@lervo/writing";

export type ConversationControlOperation = "command_status" | "approval_review";

export interface ParsedConversationControlCommand {
  operation: ConversationControlOperation;
  deliveryId: string;
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
      | "message_artifact_invalid"
      | "writing_publication_blocked",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversationControlError";
  }
}
