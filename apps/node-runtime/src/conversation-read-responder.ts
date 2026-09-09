import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

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
import {
  type DocumentRegistry,
  type RoleProfile,
  type WritingContract,
  validateSchema,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import {
  createCachedRepositorySnapshotCapture,
  type CaptureRepositorySnapshot,
} from "@lervo/orchestrator";
import { RevisionedRepositoryKnowledgeQuery } from "@lervo/repository-context";

import { AgentContextMaterializer } from "./agent-context-materialization.js";
import type { NodeDiscordConversationConfig } from "./config-types.js";
import { prepareConversationRepositoryContext } from "./conversation-repository-context.js";
import { createNodeProviderAdapter } from "./managed-provider-runtime.js";
import { SQLiteConversationResponseArtifactStore } from "./conversation-response-artifact-store.js";

const WRITING_DOCUMENT_ID = "doc_node_conversation_writing_policy";

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

function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "")}`;
}

function readOnlyRole(roleId: string, writingContract: WritingContract): RoleProfile {
  const role: RoleProfile = {
    schemaVersion: 1,
    roleId,
    name: "Conversation reader",
    description: "Answers repository questions without changing files or external state.",
    requestTypes: ["conversation.response"],
    requiredInputs: [],
    contextPolicy: {
      requiredDocumentRuleIds: ["repository.instructions", "writing.policy"],
      minimumAssurance: "E3",
      referencesRequired: true,
    },
    capabilities: {
      "filesystem.read": "allow",
      "filesystem.write": "deny",
      "shell.execute": "deny",
      "network.access": "deny",
      "external.message": "deny",
      deploy: "deny",
      "data.mutate": "deny",
    },
    defaultSkills: [],
    outputContract: {
      artifactKind: "conversation_reply",
      schemaRef: "lervo-schema://outputs/conversation-reply/v1",
      pathTemplate: ".lervo/generated/conversation/{runId}.md",
      citationsRequired: true,
      presentation: {
        audience: "human",
        locale: "en",
        writingPolicyId: writingContract.writingPolicyId,
      },
    },
    verification: { suiteIds: ["conversation.reply"], failureDisposition: "fail_run" },
    handoff: { allowedRoleIds: [], evidenceLinksRequired: true, sharedContextRequired: true },
  };
  if (!validateSchema("role", role).valid) {
    throw new Error("The managed Discord read-only role is invalid.");
  }
  return role;
}

async function provisionWritingPolicy(input: {
  repositoryRoot: string;
  dataDirectory: string;
  registry: DocumentRegistry;
  verifiedAt: string;
  writingContract: WritingContract;
}): Promise<{ registry: DocumentRegistry; path: string; contentHash: string }> {
  const content = `${JSON.stringify(input.writingContract, null, 2)}\n`;
  const contentHash = digest(content);
  const absolutePath = resolve(
    input.dataDirectory,
    `managed-read-${input.writingContract.writingPolicyId}.json`,
  );
  const path = relative(input.repositoryRoot, absolutePath).split(sep).join("/");
  if (path.startsWith("../") || path === "..") {
    throw new Error("The Discord conversation data directory is outside the repository.");
  }
  await mkdir(input.dataDirectory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(absolutePath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(absolutePath, "utf8")) !== content) {
      throw new Error(
        "The managed Discord conversation writing policy differs from runtime code.",
        {
          cause: error,
        },
      );
    }
  }
  const registry = structuredClone(input.registry);
  registry.documents[WRITING_DOCUMENT_ID] = {
    path,
    kind: "generated",
    responsibleParty: { kind: "lervo", id: "lervo-node-runtime" },
    connectedPaths: ["AGENTS.md"],
    verifiedRevision: contentHash,
    verifiedAt: input.verifiedAt,
    reviewIntervalDays: 30,
    ownership: {
      mode: "lervo_generated",
      userContentAllowed: false,
      manifestPath: path,
      inputs: [{ sourceId: `lervo:${input.writingContract.writingPolicyId}`, contentHash }],
    },
  };
  return { registry, path, contentHash };
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
    const provisioned = await provisionWritingPolicy({
      repositoryRoot: input.repositoryRoot,
      dataDirectory: input.dataDirectory,
      registry: await loadDocumentRegistry(input.repositoryRoot),
      verifiedAt: input.projectCreatedAt,
      writingContract,
    });
    const baseRole = readOnlyRole(input.config.routing.readOnlyRoleId, writingContract);
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
    const createAdapter = (adapterInput: {
      repositoryRoot: string;
      resolveArtifact: (uri: string) => Promise<Uint8Array>;
      structuredOutputSchema?: Record<string, unknown>;
    }) =>
      createNodeProviderAdapter({
        provider: input.config.routing.response.provider,
        repositoryRoot: adapterInput.repositoryRoot,
        resolveArtifact: adapterInput.resolveArtifact,
        ...(input.providerExecutables?.[input.config.routing.response.provider] === undefined
          ? {}
          : { executable: input.providerExecutables[input.config.routing.response.provider] }),
        ...(input.config.routing.response.model === undefined
          ? {}
          : { model: input.config.routing.response.model }),
        ...(input.config.routing.response.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: input.config.routing.response.reasoningEffort }),
        requestTimeoutMs: input.config.routing.response.timeoutMs ?? 60_000,
        ...(adapterInput.structuredOutputSchema === undefined
          ? {}
          : { structuredOutputSchema: adapterInput.structuredOutputSchema }),
      });
    const policyVersion = digest(
      JSON.stringify({
        role: baseRole,
        writingPolicy: writingContract,
        responseProvider: input.config.routing.response,
        surfaceEffects: input.surfaceEffects,
        conversationTurnContract: 1,
        agentContextContract: 1,
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
      request: { event: Parameters<typeof prepareConversationRepositoryContext>[0]["event"] },
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
        input.agentId === null ? null : await agentContextMaterializer.materialize(input.agentId);
      if (agentContext !== null) {
        repositoryContext.role.contextPolicy.requiredDocumentRuleIds.push("agent.context");
        repositoryContext.documentRules["agent.context"] = [agentContext.documentId];
        repositoryContext.additionalCandidates.push(agentContext);
        repositoryContext.additionalCandidates.sort((left, right) =>
          left.path.localeCompare(right.path),
        );
      }
      return {
        adapter: createAdapter({
          repositoryRoot: input.repositoryRoot,
          resolveArtifact: (uri) => input.artifactStore.get(uri),
          ...(structuredOutputSchema === undefined ? {} : { structuredOutputSchema }),
        }),
        executionIdentity: {
          agentId: input.agentId,
          provider: input.config.routing.response.provider,
          model: input.config.routing.response.model ?? null,
        },
        participationRoleId: input.participationRoleId,
        maximumResponseCharacters: 2_000,
        runId,
        sessionId: id("ses"),
        targetTurnId: id("turn"),
        role: repositoryContext.role,
        registry: provisioned.registry,
        documentRules: {
          "writing.policy": [WRITING_DOCUMENT_ID],
          ...repositoryContext.documentRules,
        },
        additionalCandidates: repositoryContext.additionalCandidates,
        recommendationBatches: repositoryContext.recommendationBatches,
        graphRecommendations: repositoryContext.graphRecommendations,
        publications: [],
        handoffs: [],
        writingPolicy: {
          writingPolicyId: writingContract.writingPolicyId,
          documentId: WRITING_DOCUMENT_ID,
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
