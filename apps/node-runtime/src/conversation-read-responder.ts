import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import {
  adaptiveConversationWritingContract,
  realtimeConversationWritingContract,
} from "@lervo/core";
import { FileSystemCas } from "@lervo/cas";
import {
  ManagedConversationResponder,
  ManagedConversationTurnResolver,
  managedConversationTurnOutputSchema,
  type ManagedConversationSurfaceEffect,
} from "@lervo/conversation-responder";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { ConversationResponder } from "@lervo/interaction";
import {
  inspectEventWriterCoordinate,
  loadDocumentRegistry,
  resolveProjectPaths,
} from "@lervo/project";
import { createLocalProviderWritingEvaluator } from "@lervo/provider-writing-evaluator";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  createCachedRepositorySnapshotCapture,
  type CaptureRepositorySnapshot,
} from "@lervo/orchestrator";
import { RevisionedRepositoryKnowledgeQuery } from "@lervo/repository-context";

import { AgentContextMaterializer } from "./agent-context-materialization.js";
import type {
  NodeDiscordConversationConfig,
  NodeRepositoryWorkExecutionProfile,
  NodeRepositoryWorkExecutionProfilePolicy,
} from "./config-types.js";
import { prepareConversationRepositoryContext } from "./conversation-repository-context.js";
import { createNodeProviderAdapter } from "./managed-provider-runtime.js";
import { SQLiteConversationResponseArtifactStore } from "./conversation-response-artifact-store.js";
import {
  conversationPolicyDigest,
  conversationWritingDocumentId,
  createConversationReadOnlyRole,
  provisionConversationWritingPolicy,
} from "./conversation-read-policy.js";

export interface ManagedConversationRepositoryResources {
  captureSnapshot: CaptureRepositorySnapshot;
  knowledgeQuery: RevisionedRepositoryKnowledgeQuery;
}

export function createManagedConversationRepositoryResources(): ManagedConversationRepositoryResources {
  return {
    captureSnapshot: createCachedRepositorySnapshotCapture(),
    knowledgeQuery: new RevisionedRepositoryKnowledgeQuery(),
  };
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

export async function openManagedConversationReadResponder(input: {
  config: NodeDiscordConversationConfig & {
    routing: NonNullable<NodeDiscordConversationConfig["routing"]>;
  };
  projectId: string;
  projectCreatedAt: string;
  agentId: string | null;
  participationRoleId: string;
  repositoryRoot: string;
  dataDirectory: string;
  artifactStore: ArtifactStore;
  surfaceEffects: readonly ManagedConversationSurfaceEffect[];
  providerExecutables?: Partial<Record<"codex" | "claude", string>>;
  providerExecutionProfiles?: Record<
    NodeRepositoryWorkExecutionProfile,
    NodeRepositoryWorkExecutionProfilePolicy
  >;
  repositoryResources?: ManagedConversationRepositoryResources | undefined;
}): Promise<{
  responder: ConversationResponder;
  turnResolver: ManagedConversationTurnResolver;
  close(): void;
}> {
  const paths = resolveProjectPaths(input.repositoryRoot);
  const writer = await inspectEventWriterCoordinate(input.repositoryRoot);
  const events = await SQLiteEventStore.open({
    path: paths.eventDatabase,
    projectId: input.projectId,
    writableEventSchemaVersion: writer.coordinate.selectedEventSchemaVersion,
  });
  let responseArtifacts: SQLiteConversationResponseArtifactStore | null = null;
  try {
    responseArtifacts = await SQLiteConversationResponseArtifactStore.open(
      resolve(input.dataDirectory, "response-artifacts.sqlite"),
    );
    const projectArtifacts = await FileSystemCas.open(paths.cas);
    const writingContract =
      input.config.routing.evaluation === undefined
        ? realtimeConversationWritingContract
        : adaptiveConversationWritingContract;
    const provisioned = await provisionConversationWritingPolicy({
      repositoryRoot: input.repositoryRoot,
      dataDirectory: input.dataDirectory,
      registry: await loadDocumentRegistry(input.repositoryRoot),
      verifiedAt: input.projectCreatedAt,
      writingContract,
    });
    const baseRole = createConversationReadOnlyRole(
      input.config.routing.readOnlyRoleId,
      writingContract,
    );
    const repositoryResources =
      input.repositoryResources ?? createManagedConversationRepositoryResources();
    const { captureSnapshot, knowledgeQuery } = repositoryResources;
    const initialSnapshot = await captureSnapshot(input.repositoryRoot);
    await knowledgeQuery.prepare({
      repositoryRoot: input.repositoryRoot,
      sourceRevision: initialSnapshot.revision,
    });
    const agentContextMaterializer = new AgentContextMaterializer({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      dataDirectory: input.dataDirectory,
      events,
      artifacts: projectArtifacts,
    });
    const responseRoute = (executionProfile?: NodeRepositoryWorkExecutionProfile) => {
      const profile =
        executionProfile === undefined
          ? undefined
          : input.providerExecutionProfiles?.[executionProfile];
      const provider = profile?.preferredProvider ?? input.config.routing.response.provider;
      const route = profile?.providers[provider];
      return {
        provider,
        model: route?.model ?? input.config.routing.response.model,
        reasoningEffort: route?.reasoningEffort ?? input.config.routing.response.reasoningEffort,
        timeoutMs: route?.timeoutMs ?? input.config.routing.response.timeoutMs ?? 60_000,
      };
    };
    const createAdapter = (adapterInput: {
      repositoryRoot: string;
      resolveArtifact: (uri: string) => Promise<Uint8Array>;
      structuredOutputSchema?: Record<string, unknown>;
      executionProfile?: NodeRepositoryWorkExecutionProfile;
    }) => {
      const route = responseRoute(adapterInput.executionProfile);
      return createNodeProviderAdapter({
        provider: route.provider,
        repositoryRoot: adapterInput.repositoryRoot,
        resolveArtifact: adapterInput.resolveArtifact,
        ...(input.providerExecutables?.[route.provider] === undefined
          ? {}
          : { executable: input.providerExecutables[route.provider] }),
        ...(route.model === undefined ? {} : { model: route.model }),
        ...(route.reasoningEffort === undefined ? {} : { reasoningEffort: route.reasoningEffort }),
        requestTimeoutMs: route.timeoutMs,
        ...(adapterInput.structuredOutputSchema === undefined
          ? {}
          : { structuredOutputSchema: adapterInput.structuredOutputSchema }),
      });
    };
    const policyVersion = conversationPolicyDigest(
      JSON.stringify({
        role: baseRole,
        writingPolicy: writingContract,
        responseProvider: input.config.routing.response,
        responseExecutionProfiles: input.providerExecutionProfiles ?? null,
        surfaceEffects: input.surfaceEffects,
        conversationTurnContract: 3,
        agentContextContract: 2,
      }),
    );
    const semanticEvaluator =
      input.config.routing.evaluation === undefined
        ? undefined
        : createLocalProviderWritingEvaluator({
            provider: input.config.routing.evaluation.provider,
            projectId: input.projectId,
            createAdapter: (adapterInput) =>
              createNodeProviderAdapter({
                ...adapterInput,
                ...(input.providerExecutables?.[adapterInput.provider] === undefined
                  ? {}
                  : { executable: input.providerExecutables[adapterInput.provider] }),
                ...(input.config.routing.evaluation?.model === undefined
                  ? {}
                  : { model: input.config.routing.evaluation.model }),
                ...(input.config.routing.evaluation?.reasoningEffort === undefined
                  ? {}
                  : { reasoningEffort: input.config.routing.evaluation.reasoningEffort }),
              }),
            createId: (prefix) => id(prefix),
            now: () => new Date(),
          });
    const resolvePlan = async (
      request: {
        event: Parameters<typeof prepareConversationRepositoryContext>[0]["event"];
        context?: {
          priorTurns: ReadonlyArray<
            import("@lervo/conversation-responder").ConversationContextTurn
          >;
          executionProfile?: NodeRepositoryWorkExecutionProfile;
        };
      },
      structuredOutputSchema?: Record<string, unknown>,
    ) => {
      const runId = id("run");
      const sourceSnapshot = await captureSnapshot(input.repositoryRoot);
      const repositoryContext = await prepareConversationRepositoryContext({
        repositoryRoot: input.repositoryRoot,
        projectId: input.projectId,
        event: request.event,
        runId,
        artifactStore: input.artifactStore,
        registry: provisioned.registry,
        baseRole,
        knowledgeQuery: (queryInput) =>
          knowledgeQuery.query({
            ...queryInput,
            sourceRevision: sourceSnapshot.revision,
          }),
      });
      const agentContext =
        input.agentId === null
          ? null
          : await agentContextMaterializer.materialize(input.agentId, {
              query: repositoryContext.query,
              observedAt: new Date(),
            });
      if (agentContext !== null) {
        repositoryContext.role.contextPolicy.requiredDocumentRuleIds.push("agent.context");
        repositoryContext.documentRules["agent.context"] = [agentContext.documentId];
        repositoryContext.additionalCandidates.push(agentContext);
        repositoryContext.additionalCandidates.sort((left, right) =>
          left.path.localeCompare(right.path),
        );
      }
      const executionProfile = request.context?.executionProfile;
      const route = responseRoute(executionProfile);
      return {
        adapter: createAdapter({
          repositoryRoot: input.repositoryRoot,
          resolveArtifact: (uri) => input.artifactStore.get(uri),
          ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
          ...(executionProfile === undefined ? {} : { executionProfile }),
        }),
        executionIdentity: {
          agentId: input.agentId,
          provider: route.provider,
          requestedModel: route.model ?? null,
        },
        deadlines: { providerTurnMs: route.timeoutMs },
        participationRoleId: input.participationRoleId,
        maximumResponseCharacters: 2_000,
        runId,
        sessionId: id("ses"),
        targetTurnId: id("turn"),
        role: repositoryContext.role,
        registry: provisioned.registry,
        documentRules: {
          "writing.policy": [conversationWritingDocumentId],
          ...repositoryContext.documentRules,
        },
        additionalCandidates: repositoryContext.additionalCandidates,
        recommendationBatches: repositoryContext.recommendationBatches,
        graphRecommendations: repositoryContext.graphRecommendations,
        publications: [],
        handoffs: [],
        writingPolicy: {
          writingPolicyId: writingContract.writingPolicyId,
          documentId: conversationWritingDocumentId,
          contentHash: provisioned.contentHash,
        },
        writingContract,
        resolvedSkills: [],
      };
    };
    const responder = new ManagedConversationResponder({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      policyVersion,
      events,
      artifactStore: input.artifactStore,
      responseArtifacts,
      captureSnapshot,
      deadlines: { providerTurnMs: input.config.routing.response.timeoutMs ?? 60_000 },
      ...(semanticEvaluator === undefined ? {} : { semanticEvaluator }),
      createEventId: () => id("evt"),
      resolvePlan: (request) => resolvePlan(request),
    });
    const turnResolver = new ManagedConversationTurnResolver({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      policyVersion,
      events,
      artifactStore: input.artifactStore,
      responseArtifacts,
      captureSnapshot,
      deadlines: { providerTurnMs: input.config.routing.response.timeoutMs ?? 60_000 },
      ...(semanticEvaluator === undefined ? {} : { semanticEvaluator }),
      createEventId: () => id("evt"),
      resolvePlan: (request) =>
        resolvePlan(request, managedConversationTurnOutputSchema(input.surfaceEffects, 2_000)),
    });
    return {
      responder,
      turnResolver,
      close: () => {
        responseArtifacts?.close();
        events.close();
      },
    };
  } catch (error) {
    responseArtifacts?.close();
    events.close();
    throw error;
  }
}
