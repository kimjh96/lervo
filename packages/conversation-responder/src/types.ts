import type { ProviderAdapter } from "@lervo/adapter-contract";
import type {
  ContextDocumentCandidate,
  ContextHandoffInput,
  DocumentRuleMap,
} from "@lervo/context";
import type { ResolvedWritingPolicy } from "@lervo/context-delivery";
import type { ConversationReplyCandidate, ConversationResponder } from "@lervo/interaction";
import type { ManagedResolvedSkill } from "@lervo/orchestrator";
import type {
  ConversationInboundEvent,
  ConversationParticipationDecision,
  ConversationParticipationPolicy,
  DocumentRegistry,
  RoleProfile,
  SharedContextPublication,
  WritingContract,
} from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import type { WritingArtifactCoordinate, WritingSemanticEvaluator } from "@lervo/writing";

export interface ManagedConversationResponsePlan {
  adapter: ProviderAdapter;
  participationRoleId?: string;
  maximumResponseCharacters?: number;
  runId: string;
  sessionId: string;
  targetTurnId: string;
  role: RoleProfile;
  registry: DocumentRegistry;
  expectedPaths?: readonly string[];
  documentRules: DocumentRuleMap;
  additionalCandidates?: readonly ContextDocumentCandidate[];
  publications: readonly SharedContextPublication[];
  handoffs: readonly ContextHandoffInput[];
  writingPolicy: ResolvedWritingPolicy;
  writingContract: WritingContract;
  resolvedSkills: readonly ManagedResolvedSkill[];
}

export interface ManagedConversationResponseRequest {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  decision: ConversationParticipationDecision;
  context?: {
    priorTurns: ReadonlyArray<{ role: "user" | "assistant"; text: string }>;
  };
}

export interface ManagedConversationResponderOptions {
  repositoryRoot: string;
  projectId: string;
  policyVersion: string;
  events: EventStore;
  artifactStore: ArtifactStore;
  semanticEvaluator: WritingSemanticEvaluator;
  resolvePlan(
    input: ManagedConversationResponseRequest,
  ): Promise<ManagedConversationResponsePlan> | ManagedConversationResponsePlan;
  now?: () => Date;
  createEventId?: () => string;
  providerSessions?: ManagedConversationProviderSessionPort;
  responseArtifacts?: ManagedConversationResponseArtifactPort;
}

export interface ManagedConversationResponseArtifactPort {
  get(requestDigest: string): Promise<WritingArtifactCoordinate | null>;
  put(input: {
    requestDigest: string;
    artifact: WritingArtifactCoordinate;
    createdAt: string;
  }): Promise<void>;
  remove(requestDigest: string): Promise<void>;
}

export interface ManagedConversationProviderSessionPort {
  claim(input: {
    projectId: string;
    provider: string;
    providerSessionId: string;
    runId: string;
    sessionId: string;
    roleId: string;
  }): Promise<boolean>;
}

export type ConversationWritingContractResolver = (input: {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
}) => Promise<WritingContract> | WritingContract;

export class ManagedConversationResponseError extends Error {
  constructor(
    readonly code:
      | "invalid_response_request"
      | "message_artifact_invalid"
      | "managed_run_invalid"
      | "writing_evaluation_unavailable"
      | "writing_publication_blocked",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ManagedConversationResponseError";
  }
}

export type ManagedConversationResponderPort = ConversationResponder & {
  respond(input: ManagedConversationResponseRequest): Promise<ConversationReplyCandidate>;
};
