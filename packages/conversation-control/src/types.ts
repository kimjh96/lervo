import type { HubCommandReview } from "@lervo/hub-control";
import type { ConversationResponder } from "@lervo/interaction";
import type { ConversationInboundEvent, WritingContract } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { WritingSemanticEvaluator } from "@lervo/writing";
import type { ConversationDeliberationSummary } from "@lervo/conversation-deliberation-contract";

export type {
  ConversationDeliberationStatus,
  ConversationDeliberationSummary,
} from "@lervo/conversation-deliberation-contract";

export type ConversationControlOperation = "command_status" | "approval_review";

export type ParsedConversationControlCommand =
  | { operation: ConversationControlOperation; deliveryId: string }
  | { operation: "deliberation_start"; policyId: string; topic: string }
  | { operation: "deliberation_resume"; deliberationId: string }
  | { operation: "deliberation_status"; deliberationId: string };

export interface ConversationDeliberationPort {
  start(input: {
    event: ConversationInboundEvent;
    policyId: string;
    topic: string;
    requestedAt: string;
  }): Promise<ConversationDeliberationSummary>;
  resume(input: {
    event: ConversationInboundEvent;
    deliberationId: string;
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

export interface ConversationDeliberationResponderOptions {
  artifactStore: ArtifactStore;
  deliberations: ConversationDeliberationPort;
  writingContract: WritingContract;
  now?: () => Date;
}

export interface ConversationRemoteContinuationPort {
  request(input: {
    projectId: string;
    conversationId: string;
    threadId: string | null;
    eventId: string;
    participantId: string;
    request: string;
    requestContentHash: string;
    requestedAt: string;
  }): Promise<{
    status: "queued" | "duplicate";
    deliveryId: string;
    commandId: string;
    provider: string;
    roleId: string;
    workstreamId: string;
    workstreamRevision: number;
    workstreamSnapshotContentHash: string;
    assignmentId: string | null;
    agentId: string | null;
    queuedAt: string;
  }>;
}

export interface ConversationRemoteContinuationResponderOptions {
  artifactStore: ArtifactStore;
  continuation: ConversationRemoteContinuationPort;
  writingContract: WritingContract;
  semanticEvaluator?: WritingSemanticEvaluator;
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
      | "remote_continuation_denied"
      | "remote_continuation_failed"
      | "writing_publication_blocked",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ConversationControlError";
  }
}
