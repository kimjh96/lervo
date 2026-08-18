import { matchesGlob } from "node:path";

import {
  decideSharedContextAccess,
  resolveHandoffContext,
} from "@lervo/core";
import type { SharedContextPublication } from "@lervo/schemas";

import { ContextSelectionAccumulator } from "./accumulator.js";
import { assertUniqueHandoffs, indexPublications } from "./collections.js";
import { candidatesFromRegistry } from "./discovery.js";
import { ContextEvidenceCollector, defaultReceiptId } from "./evidence.js";
import { normalizeRepositoryPath } from "./paths.js";
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
    return instructionDocuments.filter((document) => document.path === "AGENTS.md");
  }
  if (ruleId === "path.instructions") {
    return instructionDocuments;
  }
  return undefined;
}

export function createContextPlan(input: CreateContextPlanInput): ContextPlan {
  const publicationsById = indexPublications(input.publications);
  assertUniqueHandoffs(input.handoffs);
  const normalizedExpectedPaths = input.expectedPaths.map(normalizeRepositoryPath);
  const candidates = new Map(
    [...candidatesFromRegistry(input.registry), ...input.instructionDocuments].map(
      (candidate) => [candidate.documentId, candidate],
    ),
  );
  const accumulator = new ContextSelectionAccumulator();

  for (const instruction of input.instructionDocuments) {
    accumulator.select({
      candidate: instruction,
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
          `${candidate.documentId}의 path 규칙을 해석할 수 없습니다: ${pattern}`,
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
        `Role ${input.role.roleId}의 필수 문서 규칙 ${ruleId}을 해석할 수 없습니다.`,
      );
    }
    for (const candidate of resolved) {
      if (!candidate) continue;
      accumulator.select({
        candidate,
        reason: { reasonCode: "role_required", ruleId },
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
        `${publication.sharedContextId}이 가리키는 문서 ${publication.documentId}가 registry에 없습니다.`,
      );
    }
    accumulator.discover(candidate);
  }

  for (const handoff of input.handoffs) {
    if (handoff.bundle.toRoleId !== input.coordinates.roleId) {
      throw new ContextPreparationError(
        "handoff_recipient_mismatch",
        `${handoff.bundle.handoffId}의 수신 Role이 현재 Role과 다릅니다.`,
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
        `${handoff.bundle.handoffId}의 shared context를 사용할 수 없습니다.`,
        { cause: resolution },
      );
    }
    for (const sharedContextId of handoff.bundle.sharedContextIds) {
      const publication = publicationsById.get(sharedContextId);
      if (!publication) {
        throw new ContextPreparationError(
          "handoff_invalid",
          `${sharedContextId}의 shared context 좌표를 찾을 수 없습니다.`,
        );
      }
      const candidate = candidates.get(publication.documentId);
      if (!candidate) {
        throw new ContextPreparationError(
          "document_not_registered",
          `Handoff 문서 ${publication.documentId}가 registry에 없습니다.`,
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
    });
  }
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
