import type { ProviderAdapter } from "@lervo/adapter-contract";
import type {
  ContextDocumentCandidate,
  ContextHandoffInput,
  DocumentRuleMap,
} from "@lervo/context";
import type { ResolvedWritingPolicy } from "@lervo/context-delivery";
import type {
  ConversationCompletedEffectResult,
  ConversationReplyCandidate,
  ConversationResponder,
} from "@lervo/interaction";
import type {
  ManagedPrepareContextInput,
  ManagedProviderRunDeadlines,
  ManagedResolvedSkill,
  CaptureRepositorySnapshot,
} from "@lervo/orchestrator";
import type {
  ConversationInboundEvent,
  ConversationParticipationDecision,
  ConversationParticipationPolicy,
  DocumentRegistry,
  RoleProfile,
  SharedContextPublication,
  WritingContract,
  ProviderModelIdentity,
} from "@lervo/schemas";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import type { WritingArtifactCoordinate, WritingSemanticEvaluator } from "@lervo/writing";

export interface ManagedConversationResponsePlan {
  adapter: ProviderAdapter;
  deadlines?: Partial<ManagedProviderRunDeadlines>;
  executionIdentity: {
    agentId: string | null;
    provider: string;
    requestedModel: string | null;
  };
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
  recommendationBatches?: ManagedPrepareContextInput["recommendationBatches"];
  graphRecommendations?: ManagedPrepareContextInput["graphRecommendations"];
  publications: readonly SharedContextPublication[];
  handoffs: readonly ContextHandoffInput[];
  writingPolicy: ResolvedWritingPolicy;
  writingContract: WritingContract;
  resolvedSkills: readonly ManagedResolvedSkill[];
}

export interface ConversationContextTurn {
  role: "user" | "assistant";
  text: string;
  speaker: {
    kind: "human" | "agent" | "system";
    participantId: string;
    agentId: string | null;
    roleId: string | null;
  };
}

export interface ManagedConversationResponseRequest {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  decision: ConversationParticipationDecision;
  context?: {
    priorTurns: ReadonlyArray<ConversationContextTurn>;
    executionProfile?: "routine" | "reasoning" | "review";
    completedEffect?: ConversationCompletedEffectResult;
  };
}

export interface ManagedConversationSurfaceEffect {
  effectId: string;
  description: string;
  argumentDescription: string | null;
  argumentChoices?: ReadonlyArray<{
    value: string;
    label: string;
  }>;
  maximumArgumentCharacters?: number;
}

export interface ManagedConversationTurnRequest {
  event: ConversationInboundEvent;
  policy: ConversationParticipationPolicy;
  respondingAgent: { participantId: string; agentId: string | null; roleId: string };
  mentioned: boolean;
  surfaceEffects: readonly ManagedConversationSurfaceEffect[];
  repositoryWorkRouting?: {
    configuredDefault: {
      provider: "codex" | "claude";
      requestedModel: string | null;
      requestedReasoningEffort: "low" | "medium" | "high" | "xhigh" | "max" | null;
    };
    executionProfiles: Record<
      "routine" | "reasoning" | "review",
      {
        preferredProvider: "codex" | "claude";
        providers: Partial<
          Record<
            "codex" | "claude",
            {
              requestedModel: string | null;
              requestedReasoningEffort: "low" | "medium" | "high" | "xhigh" | "max";
            }
          >
        >;
      }
    > | null;
  };
  context?: { priorTurns: ReadonlyArray<ConversationContextTurn> };
}

export interface ManagedConversationTurnResolution {
  intent: "answer" | "continue_work" | "clarify";
  confidence: "high" | "medium" | "low";
  participation: "relevant" | "not_relevant";
  effect: { kind: "none" | "repository_work" | string; argument: string | null };
  executionProfile: "routine" | "reasoning" | "review" | null;
  provider: {
    providerId: string;
    requestedModel: string | null;
    model: string | null;
    observedModelIds: string[];
    answerModelEvidence: ProviderModelIdentity["answerModelEvidence"];
    modelUnavailableReason: string | null;
    adapterVersion: "4";
  };
  resultDigest: string;
  replyCandidate: ConversationReplyCandidate | null;
}

export interface ManagedConversationTurnResolverOptions extends ManagedConversationArtifactRunnerOptions {
  semanticEvaluator?: WritingSemanticEvaluator;
  responseArtifacts?: ManagedConversationResponseArtifactPort;
  resolvePlan(
    input: ManagedConversationTurnRequest,
  ): Promise<ManagedConversationResponsePlan> | ManagedConversationResponsePlan;
}

export interface ManagedConversationTurnResolverPort {
  resolve(input: ManagedConversationTurnRequest): Promise<ManagedConversationTurnResolution>;
}

export interface ManagedConversationResponderOptions {
  repositoryRoot: string;
  projectId: string;
  policyVersion: string;
  events: EventStore;
  artifactStore: ArtifactStore;
  semanticEvaluator?: WritingSemanticEvaluator;
  resolvePlan(
    input: ManagedConversationResponseRequest,
  ): Promise<ManagedConversationResponsePlan> | ManagedConversationResponsePlan;
  now?: () => Date;
  createEventId?: () => string;
  providerSessions?: ManagedConversationProviderSessionPort;
  responseArtifacts?: ManagedConversationResponseArtifactPort;
  deadlines?: Partial<ManagedProviderRunDeadlines>;
  captureSnapshot?: CaptureRepositorySnapshot;
}

export interface ManagedConversationArtifactRunnerOptions {
  repositoryRoot: string;
  projectId: string;
  policyVersion: string;
  events: EventStore;
  artifactStore: ArtifactStore;
  now?: () => Date;
  createEventId?: () => string;
  providerSessions?: ManagedConversationProviderSessionPort;
  deadlines?: Partial<ManagedProviderRunDeadlines>;
  captureSnapshot?: CaptureRepositorySnapshot;
}

export interface ManagedConversationResponseArtifactPort {
  get(requestDigest: string): Promise<ManagedConversationGeneratedArtifact | null>;
  put(input: {
    requestDigest: string;
    result: ManagedConversationGeneratedArtifact;
    createdAt: string;
  }): Promise<void>;
  remove(requestDigest: string): Promise<void>;
}

export interface ManagedConversationGeneratedArtifact {
  artifact: WritingArtifactCoordinate;
  modelIdentity: ProviderModelIdentity;
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
