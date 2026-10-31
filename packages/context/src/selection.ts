import { matchesGlob } from "node:path";

import { decideSharedContextAccess, resolveHandoffContext } from "@lervo/core";
import type { SharedContextPublication } from "@lervo/schemas";

import { ContextSelectionAccumulator } from "./accumulator.js";
import { assertUniqueHandoffs, indexPublications } from "./collections.js";
import { candidatesFromRegistry, isGeneratedInstructionPath } from "./discovery.js";
import { ContextEvidenceCollector, defaultReceiptId } from "./evidence.js";
import { normalizeRepositoryPath } from "./paths.js";
import {
  applySearchRecommendationBatches,
  recordSearchRecommendationEvidence,
} from "./recommendations.js";
import {
  type ContextDocumentCandidate,
  type ContextPlan,
  ContextPreparationError,
  type CreateContextPlanInput,
} from "./types.js";

function currentPublications(input: CreateContextPlanInput): SharedContextPublication[] {
  const superseded = new Set(
    input.publications
      .filter((publication) => publication.projectId === input.coordinates.projectId)
      .filter((publication) => Date.parse(publication.publishedAt) <= input.recordedAt.getTime())
      .map((publication) => publication.supersedesSharedContextId)
      .filter((id): id is string => id !== null),
  );
  return input.publications.filter(
    (publication) =>
      publication.projectId === input.coordinates.projectId &&
      !superseded.has(publication.sharedContextId),
  );
}

function instructionRuleDocuments(
  ruleId: string,
  instructionDocuments: readonly ContextDocumentCandidate[],
): readonly ContextDocumentCandidate[] | undefined {
  if (ruleId === "repository.instructions") {
    return instructionDocuments.filter(
      (document) => document.path === "AGENTS.md" || isGeneratedInstructionPath(document.path),
    );
  }
  if (ruleId === "path.instructions") {
    return instructionDocuments;
  }
  return undefined;
}

function knowledgeMetadataEqual(
  left: ContextDocumentCandidate["knowledgeContext"],
  right: ContextDocumentCandidate["knowledgeContext"],
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.conceptId === right.conceptId &&
    left.assurance === right.assurance &&
    left.freshness === right.freshness &&
    left.sourceSnapshotId === right.sourceSnapshotId &&
    left.impactReportId === right.impactReportId
  );
}

function indexCandidates(input: CreateContextPlanInput): Map<string, ContextDocumentCandidate> {
  if (
    (input.additionalCandidates ?? []).some(
      (candidate) =>
        candidate.source !== "knowledge" &&
        candidate.source !== "workstream" &&
        candidate.source !== "agent_context",
    )
  ) {
    throw new ContextPreparationError(
      "invalid_context_plan",
      "Additional context candidates must be repository knowledge, workstream, or agent-context sources.",
    );
  }
  const byId = new Map<string, ContextDocumentCandidate>();
  const byPath = new Map<string, ContextDocumentCandidate>();
  for (const candidate of [
    ...candidatesFromRegistry(input.registry),
    ...input.instructionDocuments,
    ...(input.additionalCandidates ?? []),
  ]) {
    const path = normalizeRepositoryPath(candidate.path);
    if (path !== candidate.path) {
      throw new ContextPreparationError(
        "invalid_context_plan",
        `The context candidate path is not normalized: ${candidate.path}`,
      );
    }
    if ((candidate.source === "knowledge") !== (candidate.knowledgeContext !== undefined)) {
      throw new ContextPreparationError(
        "invalid_context_plan",
        `The knowledge candidate and knowledge metadata do not match: ${candidate.documentId}`,
      );
    }
    const sameId = byId.get(candidate.documentId);
    if (
      sameId !== undefined &&
      sameId.path === candidate.path &&
      sameId.source !== "knowledge" &&
      candidate.source === "knowledge" &&
      candidate.knowledgeContext !== undefined
    ) {
      const augmented = {
        ...sameId,
        source: "knowledge" as const,
        documentRole:
          sameId.documentRole === "governance_context" ||
          candidate.documentRole === "governance_context"
            ? ("governance_context" as const)
            : ("task_evidence" as const),
        referenceEligible:
          sameId.documentRole === "governance_context" ||
          candidate.documentRole === "governance_context"
            ? false
            : sameId.referenceEligible || candidate.referenceEligible,
        knowledgeContext: structuredClone(candidate.knowledgeContext),
      };
      byId.set(candidate.documentId, augmented);
      byPath.set(candidate.path, augmented);
      continue;
    }
    if (
      sameId !== undefined &&
      (sameId.path !== candidate.path ||
        sameId.source !== candidate.source ||
        !knowledgeMetadataEqual(sameId.knowledgeContext, candidate.knowledgeContext))
    ) {
      throw new ContextPreparationError(
        "invalid_context_plan",
        `The context candidate ID references different documents: ${candidate.documentId}`,
      );
    }
    if (sameId !== undefined && sameId.documentRole !== candidate.documentRole) {
      const merged = {
        ...sameId,
        documentRole: "governance_context" as const,
        referenceEligible: false,
      };
      byId.set(candidate.documentId, merged);
      byPath.set(candidate.path, merged);
      continue;
    }
    const samePath = byPath.get(candidate.path);
    if (samePath !== undefined && samePath.documentId !== candidate.documentId) {
      throw new ContextPreparationError(
        "duplicate_document_path",
        `${candidate.path} is duplicated for ${samePath.documentId} and ${candidate.documentId}.`,
      );
    }
    if (sameId === undefined) byId.set(candidate.documentId, candidate);
    if (samePath === undefined) byPath.set(candidate.path, candidate);
  }
  return byId;
}

export function createContextPlan(input: CreateContextPlanInput): ContextPlan {
  const publicationsById = indexPublications(input.publications);
  assertUniqueHandoffs(input.handoffs);
  const normalizedExpectedPaths = input.expectedPaths.map(normalizeRepositoryPath);
  const candidates = indexCandidates(input);
  const accumulator = new ContextSelectionAccumulator();

  for (const instruction of input.instructionDocuments) {
    const candidate = candidates.get(instruction.documentId) ?? instruction;
    accumulator.select({
      candidate,
      ...(instruction.expectedContentHash === undefined
        ? {}
        : { expectedContentHash: instruction.expectedContentHash }),
      reason: {
        reasonCode:
          instruction.path === "AGENTS.md" ? "explicit_instruction" : "parent_instruction",
        ruleId: `instruction:${instruction.path}`,
      },
    });
  }

  for (const candidate of candidates.values()) {
    for (const pattern of candidate.connectedPaths) {
      let matched;
      try {
        matched = normalizedExpectedPaths.some((path) => matchesGlob(path, pattern));
      } catch (error) {
        throw new ContextPreparationError(
          "invalid_path_rule",
          `The path rule for ${candidate.documentId} cannot be resolved: ${pattern}`,
          { cause: error },
        );
      }
      if (matched) {
        accumulator.select({
          candidate,
          reason: {
            reasonCode: "path_rule",
            ruleId: `path:${candidate.documentId}:${pattern}`,
          },
        });
      }
    }
  }

  for (const ruleId of input.role.contextPolicy.requiredDocumentRuleIds) {
    const builtIn = instructionRuleDocuments(ruleId, input.instructionDocuments);
    const documentIds = input.documentRules[ruleId];
    const resolved = builtIn ?? documentIds?.map((documentId) => candidates.get(documentId));
    if (!resolved || resolved.length === 0 || resolved.some((document) => !document)) {
      throw new ContextPreparationError(
        "required_rule_unresolved",
        `Required document rule ${ruleId} for role ${input.role.roleId} cannot be resolved.`,
      );
    }
    for (const resolvedCandidate of resolved) {
      if (!resolvedCandidate) continue;
      const candidate = candidates.get(resolvedCandidate.documentId) ?? resolvedCandidate;
      accumulator.select({
        candidate,
        reason: { reasonCode: "role_required", ruleId },
        ...(ruleId === "writing.policy"
          ? { documentRole: "governance_context", referenceEligible: false }
          : {}),
      });
    }
  }

  const activePublications = currentPublications(input);
  for (const publication of activePublications) {
    const access = decideSharedContextAccess({
      publication,
      roleId: input.coordinates.roleId,
      at: input.recordedAt,
    });
    if (!access.allowed) continue;
    const candidate = candidates.get(publication.documentId);
    if (!candidate) {
      throw new ContextPreparationError(
        "shared_context_document_missing",
        `Document ${publication.documentId} referenced by ${publication.sharedContextId} is not in the registry.`,
      );
    }
    accumulator.discover(candidate);
  }

  for (const handoff of input.handoffs) {
    if (handoff.bundle.toRoleId !== input.coordinates.roleId) {
      throw new ContextPreparationError(
        "handoff_recipient_mismatch",
        `The recipient role of ${handoff.bundle.handoffId} differs from the current role.`,
      );
    }
    const resolution = resolveHandoffContext({
      handoff: handoff.bundle,
      producerRole: handoff.producerRole,
      publications: input.publications,
      at: input.recordedAt,
    });
    if (!resolution.allowed) {
      throw new ContextPreparationError(
        "handoff_invalid",
        `The shared context of ${handoff.bundle.handoffId} is unavailable.`,
        { cause: resolution },
      );
    }
    for (const sharedContextId of handoff.bundle.sharedContextIds) {
      const publication = publicationsById.get(sharedContextId);
      if (!publication) {
        throw new ContextPreparationError(
          "handoff_invalid",
          `The shared context coordinates for ${sharedContextId} cannot be found.`,
        );
      }
      const candidate = candidates.get(publication.documentId);
      if (!candidate) {
        throw new ContextPreparationError(
          "document_not_registered",
          `Handoff document ${publication.documentId} is not in the registry.`,
        );
      }
      accumulator.select({
        candidate,
        reason: {
          reasonCode: "handoff",
          ruleId: `handoff:${handoff.bundle.handoffId}`,
        },
        sharedContextId: publication.sharedContextId,
        expectedContentHash: publication.contentHash,
      });
    }
  }

  const recommendations = applySearchRecommendationBatches({
    batches: input.recommendationBatches ?? [],
    coordinates: input.coordinates,
    recordedAt: input.recordedAt,
    candidates,
    accumulator,
  });

  const documents = accumulator.documents();
  const createReceiptId = input.createReceiptId ?? defaultReceiptId;
  const evidence = new ContextEvidenceCollector();
  const recordedAt = input.recordedAt.toISOString();
  for (const candidate of accumulator.discoveries()) {
    evidence.add({
      receiptId: createReceiptId(),
      projectId: input.coordinates.projectId,
      runId: input.coordinates.runId,
      sessionId: input.coordinates.sessionId,
      documentId: candidate.documentId,
      state: "discovered",
      recordedAt,
      path: candidate.path,
      ...(candidate.knowledgeContext === undefined
        ? {}
        : { knowledgeContext: structuredClone(candidate.knowledgeContext) }),
    });
  }
  recordSearchRecommendationEvidence({
    applied: recommendations,
    coordinates: input.coordinates,
    recordedAt,
    createReceiptId,
    evidence,
  });
  for (const document of documents) {
    for (const reason of document.reasons) {
      evidence.add({
        receiptId: createReceiptId(),
        projectId: input.coordinates.projectId,
        runId: input.coordinates.runId,
        sessionId: input.coordinates.sessionId,
        documentId: document.documentId,
        state: "selected",
        recordedAt,
        required: document.required,
        scope: document.scope,
        policyVersion: input.policyVersion,
        reasonCode: reason.reasonCode,
        ruleId: reason.ruleId,
        ...(document.knowledgeContext === undefined
          ? {}
          : { knowledgeContext: structuredClone(document.knowledgeContext) }),
      });
    }
  }
  return {
    coordinates: input.coordinates,
    documents,
    evidence: evidence.values(),
    createdAt: recordedAt,
  };
}
