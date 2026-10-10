import { createHash } from "node:crypto";

import type { RepositoryWorkProvider, RepositoryWorkTurnUsage } from "@lervo/adapter-contract";
import { readRepositoryFile } from "@lervo/context";
import {
  createTurnMeasurement,
  recordTurnMeasurement,
  type TurnUsageObservation,
} from "@lervo/execution-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  prepareManagedOperationalSearchContext,
  prepareManagedSearchContext,
  productDefaultSearchEngine,
} from "@lervo/repository-context";
import { RepositoryKnowledgeError } from "@lervo/repository-knowledge";

/** ADR-0459 bounds the context a repository-work turn points at to three documents. */
const MAXIMUM_CONTEXT_DOCUMENTS = 3;
const MAXIMUM_CONTEXT_DOCUMENT_BYTES = 131_072;
const ADAPTER_VERSION = "1";

function sha256(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/** The run and session that hold every canonical record of one conversation work turn. */
export function conversationRepositoryWorkCoordinates(sourceConversationEventId: string): {
  runId: string;
  sessionId: string;
} {
  const coordinate = sha256(sourceConversationEventId).slice("sha256:".length, 31);
  return {
    runId: `run_conversation_${coordinate}`,
    sessionId: `ses_conversation_${coordinate}`,
  };
}

export function conversationDigest(conversationId: string, threadId: string | null): string {
  return sha256(`lervo.conversation.digest.v1\0${conversationId}\0${threadId ?? ""}`);
}

export interface RepositoryWorkContextDocument {
  documentId: string;
  path: string;
  contentHash: string;
  byteCount: number;
}

/** Documents Lervo selected and loaded for the turn; injection and use remain unclaimed. */
export interface RepositoryWorkContextReceipt {
  sourceRevision: string;
  documents: RepositoryWorkContextDocument[];
  /**
   * Set when retrieval failed and the receipt is empty. Retrieval quality is not a measurement
   * failure: the turn proceeds without pointers, and only unrecordable records fail the gate.
   */
  retrievalFailureCode?: string;
}

export interface RepositoryWorkMeasurementRecord {
  repositoryRoot: string;
  sourceConversationEventId: string;
  conversationId: string;
  threadId: string | null;
  workerAgentId: string;
  provider: RepositoryWorkProvider;
  requestedModel: string | null;
  providerSessionId: string;
  usage: RepositoryWorkTurnUsage | undefined;
  receipt: RepositoryWorkContextReceipt;
  occurredAt: string;
}

/** The measurement lifecycle of one repository-work turn; tests replace it with a recording fake. */
export interface ConversationRepositoryWorkMeasurement {
  prepareContext(input: {
    repositoryRoot: string;
    request: string;
    sourceRevision: string;
  }): Promise<RepositoryWorkContextReceipt>;
  record(input: RepositoryWorkMeasurementRecord): Promise<void>;
}

async function searchCandidates(repositoryRoot: string, projectId: string, request: string) {
  const searchInput = {
    repositoryRoot,
    projectId,
    query: request,
    origin: "conversation" as const,
    fallbackQuery: "repository work context",
    observedAt: new Date(),
    productDefault: productDefaultSearchEngine,
  };
  try {
    return (await prepareManagedSearchContext(searchInput)).additionalCandidates;
  } catch (error) {
    if (
      !(error instanceof RepositoryKnowledgeError) ||
      error.code !== "knowledge_recovery_required"
    )
      throw error;
    return (await prepareManagedOperationalSearchContext(searchInput)).additionalCandidates;
  }
}

function retrievalFailureCode(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code)
    ? code
    : "retrieval_failed";
}

async function prepareRepositoryWorkContext(input: {
  repositoryRoot: string;
  request: string;
  sourceRevision: string;
}): Promise<RepositoryWorkContextReceipt> {
  const storage = await openProjectStorage(input.repositoryRoot);
  let projectId: string;
  try {
    projectId = storage.manifest.projectId;
  } finally {
    await storage.close();
  }
  let candidates: Awaited<ReturnType<typeof searchCandidates>>;
  try {
    candidates = await searchCandidates(input.repositoryRoot, projectId, input.request);
  } catch (error) {
    return {
      sourceRevision: input.sourceRevision,
      documents: [],
      retrievalFailureCode: retrievalFailureCode(error),
    };
  }
  const documents: RepositoryWorkContextDocument[] = [];
  for (const candidate of candidates) {
    if (documents.length >= MAXIMUM_CONTEXT_DOCUMENTS) break;
    if (documents.some((document) => document.documentId === candidate.documentId)) continue;
    const bytes = await readRepositoryFile(
      input.repositoryRoot,
      candidate.path,
      MAXIMUM_CONTEXT_DOCUMENT_BYTES,
    );
    documents.push({
      documentId: candidate.documentId,
      path: candidate.path,
      contentHash: sha256(bytes),
      byteCount: bytes.byteLength,
    });
  }
  return { sourceRevision: input.sourceRevision, documents };
}

function usageObservation(usage: RepositoryWorkTurnUsage | undefined): TurnUsageObservation {
  if (usage === undefined)
    return { status: "unavailable", reasonCode: "provider_usage_unreported" };
  return usage.status === "observed"
    ? { status: "observed", source: "provider_reported", usage: usage.usage }
    : { status: "unavailable", reasonCode: usage.reasonCode };
}

async function recordRepositoryWorkMeasurement(input: RepositoryWorkMeasurementRecord) {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const measurement = createTurnMeasurement({
      coordinates: {
        projectId: storage.manifest.projectId,
        ...conversationRepositoryWorkCoordinates(input.sourceConversationEventId),
      },
      attribution: {
        agentId: input.workerAgentId,
        conversationDigest: conversationDigest(input.conversationId, input.threadId),
        channel: "conversation",
        turnEventId: input.sourceConversationEventId,
        stage: "repository_work_turn",
      },
      source: {
        provider: input.provider,
        adapterId: input.usage?.adapterId ?? `${input.provider}/repository-work`,
        adapterVersion: ADAPTER_VERSION,
        nativeCounterSemanticsId:
          input.usage?.nativeCounterSemanticsId ?? "repository-work.usage-unreported",
        requestedModel: input.requestedModel,
        providerSessionId: input.providerSessionId,
      },
      usage: usageObservation(input.usage),
      context: {
        sourceRevision: input.receipt.sourceRevision,
        documents: input.receipt.documents.map((document) => ({
          documentId: document.documentId,
          contentHash: document.contentHash,
          byteCount: document.byteCount,
          ruleId: "repository_work.search",
        })),
      },
      occurredAt: input.occurredAt,
    });
    await recordTurnMeasurement(storage, measurement);
  } finally {
    await storage.close();
  }
}

export const repositoryWorkMeasurement: ConversationRepositoryWorkMeasurement = {
  prepareContext: prepareRepositoryWorkContext,
  record: recordRepositoryWorkMeasurement,
};

/** Instruction text naming the selected documents; it carries pointers and hashes, never bytes. */
export function repositoryWorkContextPointers(
  receipt: RepositoryWorkContextReceipt,
): string | null {
  if (receipt.documents.length === 0) return null;
  return [
    "Lervo selected these canonical repository documents for this request. Read the relevant ones before relying on memory:",
    ...receipt.documents.map((document) => `- ${document.path} (${document.contentHash})`),
  ].join("\n");
}
