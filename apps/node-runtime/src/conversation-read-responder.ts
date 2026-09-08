import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import {
  adaptiveConversationWritingContract,
  realtimeConversationWritingContract,
} from "@lervo/core";
import { ManagedConversationResponder } from "@lervo/conversation-responder";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { ConversationResponder } from "@lervo/interaction";
import {
  inspectEventWriterCoordinate,
  loadDocumentRegistry,
  resolveProjectPaths,
} from "@lervo/project";
import { createLocalProviderWritingEvaluator } from "@lervo/provider-writing-evaluator";
import { documentIdForPath } from "@lervo/context";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge/workstream";
import {
  type DocumentRegistry,
  type RoleProfile,
  type WritingContract,
  validateSchema,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { NodeDiscordConversationConfig } from "./config-types.js";
import { createNodeProviderAdapter } from "./managed-provider-runtime.js";
import { SQLiteConversationResponseArtifactStore } from "./conversation-response-artifact-store.js";

const WRITING_DOCUMENT_ID = "doc_node_conversation_writing_policy";

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
  providerExecutables?: Partial<Record<"codex" | "claude", string>>;
}): Promise<{ responder: ConversationResponder; close(): void }> {
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
    const createAdapter = (adapterInput: {
      repositoryRoot: string;
      resolveArtifact: (uri: string) => Promise<Uint8Array>;
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
      });
    const responder = new ManagedConversationResponder({
      repositoryRoot: input.repositoryRoot,
      projectId: input.projectId,
      policyVersion: digest(
        JSON.stringify({
          role: baseRole,
          writingPolicy: writingContract,
          responseProvider: input.config.routing.response,
        }),
      ),
      events,
      artifactStore: input.artifactStore,
      responseArtifacts,
      ...(input.config.routing.evaluation === undefined
        ? {}
        : {
            semanticEvaluator: createLocalProviderWritingEvaluator({
              provider: input.config.routing.evaluation.provider,
              projectId: input.projectId,
              createAdapter: (adapterInput) =>
                createNodeProviderAdapter({
                  ...adapterInput,
                  ...(input.providerExecutables?.[adapterInput.provider] === undefined
                    ? {}
                    : {
                        executable: input.providerExecutables[adapterInput.provider],
                      }),
                  ...(input.config.routing.evaluation?.model === undefined
                    ? {}
                    : { model: input.config.routing.evaluation.model }),
                  ...(input.config.routing.evaluation?.reasoningEffort === undefined
                    ? {}
                    : { reasoningEffort: input.config.routing.evaluation.reasoningEffort }),
                }),
              createId: (prefix) => id(prefix),
              now: () => new Date(),
            }),
          }),
      createEventId: () => id("evt"),
      resolvePlan: async () => {
        const currentWorkstream = await readCurrentWorkstreamState(input.repositoryRoot);
        const workstreamPath = ".lervo/state/workstreams/current.json";
        const workstreamDocumentId = documentIdForPath(workstreamPath);
        const role = structuredClone(baseRole);
        if (currentWorkstream !== null) {
          role.contextPolicy.requiredDocumentRuleIds.push("repository.workstream");
        }
        return {
          adapter: createAdapter({
            repositoryRoot: input.repositoryRoot,
            resolveArtifact: (uri) => input.artifactStore.get(uri),
          }),
          executionIdentity: {
            agentId: input.agentId,
            provider: input.config.routing.response.provider,
            model: input.config.routing.response.model ?? null,
          },
          participationRoleId: input.participationRoleId,
          maximumResponseCharacters: 2_000,
          runId: id("run"),
          sessionId: id("ses"),
          targetTurnId: id("turn"),
          role,
          registry: provisioned.registry,
          documentRules: {
            "writing.policy": [WRITING_DOCUMENT_ID],
            ...(currentWorkstream === null
              ? {}
              : { "repository.workstream": [workstreamDocumentId] }),
          },
          ...(currentWorkstream === null
            ? {}
            : {
                additionalCandidates: [
                  {
                    documentId: workstreamDocumentId,
                    path: workstreamPath,
                    connectedPaths: [],
                    source: "workstream" as const,
                    documentRole: "governance_context" as const,
                    referenceEligible: false,
                  },
                ],
              }),
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
      },
    });
    return {
      responder,
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
