import { loadDecisionTaxonomy } from "@lervo/project";
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
  type KnowledgeConvergenceInput,
  type RepositoryLayoutMigrationPlan,
} from "@lervo/repository-knowledge";

import { assertConvergenceDelegation } from "./delegation.js";
import { reviewKnowledgeJson } from "./provider-call.js";
import { convergenceSourceBytes } from "./source-capture.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { withConvergenceAssignment } from "./workforce.js";

/**
 * ADR-0476: the background resident classifies documents a layout plan deferred, through the
 * no-capability provider adapter under the convergence delegation. It records evidence only; the
 * move it enables still goes through the exact lifecycle plan, its independent review, and apply.
 * Returns the number of documents it recorded, zero when no pending bytes were current.
 */
export async function classifyDeferredDocumentRoutes(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
  layout: RepositoryLayoutMigrationPlan,
): Promise<number> {
  const root = context.storage.paths.repositoryRoot;
  const pending = layout.deferredDocuments.filter(
    (document) => document.reason === "semantic_classification_pending",
  );
  if (pending.length === 0) return 0;
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: root,
    projectId: state.baseline.projectId,
    expectedHash: state.baseline.delegationHash,
    provider: context.provider,
  });
  if (delegation.resourceCeilings.maximumProviderCalls < 1) return 0;
  const documents = pending
    .flatMap((document) => {
      const bytes = convergenceSourceBytes(root, document.path);
      // Bytes that moved under the plan are classified on a later cycle, never under a stale hash.
      return sha256(bytes) === document.contentHash
        ? [{ ...document, content: new TextDecoder("utf8").decode(bytes) }]
        : [];
    })
    .slice(0, Math.min(MAXIMUM_DOCUMENT_ROUTE_BATCH, delegation.resourceCeilings.maximumDocuments));
  if (documents.length === 0) return 0;
  const taxonomy = await loadDecisionTaxonomy(root);
  const { request, requestDigest } = createDocumentRouteClassificationRequest({
    taxonomy,
    documents: documents.map((document) => ({
      subject: document.subject,
      path: document.path,
      contentHash: document.contentHash,
      workspacePackage: document.workspacePackage,
      content: document.content,
    })),
  });
  const paths = request.documents.map((document) => document.path);
  try {
    await withConvergenceAssignment({
      storage: context.storage,
      provider: context.provider,
      stage: "assessment",
      role: "generator",
      state,
      paths,
      assertLease,
      run: async (authority) => {
        const observed = await reviewKnowledgeJson({
          budget: {
            batchId: `${state.obligationId}:${requestDigest}:document_route`,
            maximumCalls: 1,
          },
          context,
          state,
          authority,
          prompt: documentRouteClassificationInstruction,
          task: DOCUMENT_ROUTE_CLASSIFICATION_TASK,
          schema: documentRouteClassificationResponseSchema,
          contextDocuments: [],
          untrustedSourceData: request,
        });
        const verdicts = interpretDocumentRouteClassificationResponse(request, observed.value);
        await recordDocumentRouteClassifications({
          repositoryRoot: root,
          records: createDocumentRouteClassificationRecords({
            request,
            requestDigest,
            verdicts,
            provider: context.provider,
            responseDigest: sha256(canonicalJson(observed.value)),
            observationArtifactHash: observed.observationArtifactHash,
            classifiedAt: new Date(),
          }),
          liveClassificationIds: new Set(layout.semanticClassificationIds),
        });
        return {
          state: "current",
          input: state,
          assignmentId: null,
          leaseGeneration: null,
          failureCode: null,
          dependencyHash: null,
          nextStage: "assessment",
        };
      },
    });
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    if (
      code !== undefined &&
      [
        "knowledge_capacity_unavailable",
        "knowledge_provider_paused",
        "knowledge_usage_unavailable",
        "knowledge_compile_failed",
      ].includes(code)
    )
      return 0;
    throw error;
  }
  return documents.length;
}
