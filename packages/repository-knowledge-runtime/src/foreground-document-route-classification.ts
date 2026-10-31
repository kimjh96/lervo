import { loadDecisionTaxonomy } from "@lervo/project";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  canonicalJson,
  createDocumentRouteClassificationRecords,
  createDocumentRouteClassificationRequest,
  DOCUMENT_ROUTE_CLASSIFICATION_TASK,
  documentRouteClassificationInstruction,
  documentRouteClassificationResponseSchema,
  interpretDocumentRouteClassificationResponse,
  MAXIMUM_DOCUMENT_ROUTE_BATCH,
  recordDocumentRouteClassifications,
  sha256,
  type RepositoryLayoutMigrationPlan,
} from "@lervo/repository-knowledge";
import {
  createNoCapabilityProviderJsonRunner,
  KnowledgeProviderAvailabilityError,
} from "@lervo/repository-knowledge-compiler";

import { acquireKnowledgeProviderAdmission, pauseKnowledgeProvider } from "./provider-admission.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { convergenceSourceBytes } from "./source-capture.js";

/** The owner's foreground invocation authorizes classification evidence, never a document move. */
export async function classifyForegroundDocumentRoutes(input: {
  storage: ProjectStorage;
  layout: RepositoryLayoutMigrationPlan;
  provider: "codex" | "claude";
  model?: string;
  executable?: string;
  timeoutMs?: number;
  admissionDirectory?: string;
}): Promise<{ recorded: number; providerAvailable: boolean }> {
  const root = input.storage.paths.repositoryRoot;
  const documents = input.layout.deferredDocuments
    .filter((document) => document.reason === "semantic_classification_pending")
    .slice(0, MAXIMUM_DOCUMENT_ROUTE_BATCH)
    .flatMap((document) => {
      const bytes = convergenceSourceBytes(root, document.path);
      return sha256(bytes) === document.contentHash
        ? [{ ...document, content: new TextDecoder().decode(bytes) }]
        : [];
    });
  if (documents.length === 0) return { recorded: 0, providerAvailable: true };
  const directory =
    input.admissionDirectory === undefined ? {} : { directory: input.admissionDirectory };
  let admission;
  try {
    admission = await acquireKnowledgeProviderAdmission({
      repositoryRoot: root,
      provider: input.provider,
      // This is the foreground request itself; it still shares pause and host capacity admission.
      liveWorkPending: async () => false,
      ...directory,
    });
  } catch (error) {
    if (
      error instanceof KnowledgeConvergenceRuntimeError &&
      [
        "knowledge_provider_paused",
        "knowledge_capacity_unavailable",
        "knowledge_provider_rejected",
        "knowledge_provider_admission_rejected",
      ].includes(error.code)
    )
      return { recorded: 0, providerAvailable: false };
    throw error;
  }
  if (admission === null) return { recorded: 0, providerAvailable: false };
  try {
    const { request, requestDigest } = createDocumentRouteClassificationRequest({
      taxonomy: await loadDecisionTaxonomy(root),
      documents,
    });
    let observed;
    try {
      const runner = await createNoCapabilityProviderJsonRunner({
        provider: input.provider,
        ...(input.model === undefined ? {} : { model: input.model }),
        ...(input.executable === undefined ? {} : { executable: input.executable }),
        timeoutMs: input.timeoutMs ?? 300_000,
        systemPrompt: documentRouteClassificationInstruction,
      });
      if (runner.resolveObserved === undefined) return { recorded: 0, providerAvailable: false };
      observed = await runner.resolveObserved({
        schemaVersion: 1,
        task: DOCUMENT_ROUTE_CLASSIFICATION_TASK,
        responseContract: { schemaVersion: 1, schema: documentRouteClassificationResponseSchema },
        untrustedSourceData: request,
      });
      if (observed.usage === null) return { recorded: 0, providerAvailable: false };
    } catch (error) {
      if (error instanceof KnowledgeProviderAvailabilityError)
        await pauseKnowledgeProvider({
          provider: input.provider,
          reason: error.reason,
          observationHash: error.observationHash,
          resetAt: error.resetAt,
          ...directory,
        });
      return { recorded: 0, providerAvailable: false };
    }
    const proof = await input.storage.artifacts.put(
      canonicalJson({
        schemaVersion: 1,
        kind: "foreground_document_route_classification",
        task: DOCUMENT_ROUTE_CLASSIFICATION_TASK,
        requestDigest,
        value: observed.value,
        usage: observed.usage,
        admissionObservationHash: admission.observationHash,
      }),
    );
    await recordDocumentRouteClassifications({
      repositoryRoot: root,
      records: createDocumentRouteClassificationRecords({
        request,
        requestDigest,
        verdicts: interpretDocumentRouteClassificationResponse(request, observed.value),
        provider: input.provider,
        responseDigest: sha256(canonicalJson(observed.value)),
        observationArtifactHash: proof.contentHash,
        classifiedAt: new Date(),
      }),
      liveClassificationIds: new Set(input.layout.semanticClassificationIds),
    });
    return { recorded: documents.length, providerAvailable: true };
  } finally {
    await admission.release();
  }
}
