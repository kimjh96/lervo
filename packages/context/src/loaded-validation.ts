import { createHash } from "node:crypto";

import {
  contextScopesEqual,
  type ContextEvidence,
  type KnowledgeContextMetadata,
  validateSchema,
} from "@lervo/schemas";

import { validateContextPlanForLoading } from "./plan-validation.js";
import {
  ContextPreparationError,
  type ContextSelectionReason,
  type LoadedContext,
} from "./types.js";

type PlanEvidence = Extract<ContextEvidence, { state: "discovered" | "recommended" | "selected" }>;
type LoadedEvidence = Extract<ContextEvidence, { state: "loaded" }>;

function invalid(message: string, cause?: unknown): never {
  throw new ContextPreparationError(
    "invalid_loaded_context",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function stringSetsEqual(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === left.length &&
    rightSet.size === right.length &&
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function reasonsEqual(
  left: readonly ContextSelectionReason[],
  right: readonly ContextSelectionReason[],
): boolean {
  const key = (reason: ContextSelectionReason): string => `${reason.reasonCode}\0${reason.ruleId}`;
  return stringSetsEqual(left.map(key), right.map(key));
}

function metadataEqual(
  left: KnowledgeContextMetadata | undefined,
  right: KnowledgeContextMetadata | undefined,
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

function planEvidenceEqual(left: PlanEvidence, right: ContextEvidence | undefined): boolean {
  if (
    right === undefined ||
    left.state !== right.state ||
    left.receiptId !== right.receiptId ||
    left.projectId !== right.projectId ||
    left.runId !== right.runId ||
    left.sessionId !== right.sessionId ||
    left.documentId !== right.documentId ||
    left.recordedAt !== right.recordedAt
  ) {
    return false;
  }
  if (left.state === "discovered" && right.state === "discovered") {
    return left.path === right.path && metadataEqual(left.knowledgeContext, right.knowledgeContext);
  }
  if (left.state === "recommended" && right.state === "recommended") {
    return (
      left.recommendationId === right.recommendationId &&
      left.batchId === right.batchId &&
      left.sourceAttemptId === right.sourceAttemptId &&
      left.engineId === right.engineId &&
      left.engineVersion === right.engineVersion &&
      left.indexId === right.indexId &&
      left.resultSetHash === right.resultSetHash &&
      left.sourceContentHash === right.sourceContentHash &&
      left.rank === right.rank &&
      left.score === right.score &&
      left.selectionPolicyId === right.selectionPolicyId &&
      left.selectionPolicyVersion === right.selectionPolicyVersion &&
      left.selectionMaximum === right.selectionMaximum &&
      metadataEqual(left.knowledgeContext, right.knowledgeContext)
    );
  }
  return (
    left.state === "selected" &&
    right.state === "selected" &&
    left.required === right.required &&
    contextScopesEqual(left.scope, right.scope) &&
    left.policyVersion === right.policyVersion &&
    left.reasonCode === right.reasonCode &&
    left.ruleId === right.ruleId &&
    metadataEqual(left.knowledgeContext, right.knowledgeContext)
  );
}

export function assertLoadedContextIntegrity(loaded: LoadedContext): void {
  try {
    validateContextPlanForLoading(loaded.plan);
  } catch (error) {
    invalid("The E2 context plan is invalid.", error);
  }
  const planCreatedAt = Date.parse(loaded.plan.createdAt);
  const loadedAt = Date.parse(loaded.loadedAt);
  if (!Number.isFinite(planCreatedAt) || !Number.isFinite(loadedAt) || loadedAt < planCreatedAt) {
    invalid("The LoadedContext plan/E2 time ordering is invalid.");
  }
  if (loaded.documents.length !== loaded.plan.documents.length) {
    invalid("The E2 document count differs from the context plan.");
  }

  const loadedDocuments = new Map(
    loaded.documents.map((document) => [document.documentId, document]),
  );
  if (loadedDocuments.size !== loaded.documents.length) {
    invalid("LoadedContext contains duplicate document IDs.");
  }
  for (const planned of loaded.plan.documents) {
    const document = loadedDocuments.get(planned.documentId);
    if (
      document === undefined ||
      document.path !== planned.path ||
      document.required !== planned.required ||
      !contextScopesEqual(document.scope, planned.scope) ||
      document.documentRole !== planned.documentRole ||
      document.referenceEligible !== planned.referenceEligible ||
      !reasonsEqual(document.reasons, planned.reasons) ||
      !stringSetsEqual(document.sharedContextIds, planned.sharedContextIds) ||
      document.expectedContentHash !== planned.expectedContentHash ||
      !metadataEqual(document.knowledgeContext, planned.knowledgeContext)
    ) {
      invalid(`The E2 document differs from the context plan: ${planned.documentId}`);
    }
    if (
      document.byteCount !== document.bytes.byteLength ||
      document.contentHash !== hash(document.bytes) ||
      document.sourceRevision.length === 0 ||
      (document.expectedContentHash !== undefined &&
        document.expectedContentHash !== document.contentHash)
    ) {
      invalid(`The E2 document bytes and evidence do not match: ${document.documentId}`);
    }
  }

  const evidenceIds = new Set<string>();
  const loadedEvidence = new Map<string, LoadedEvidence>();
  const evidenceById = new Map<string, ContextEvidence>();
  for (const evidence of loaded.evidence) {
    const validation = validateSchema("contextEvidence", evidence);
    if (!validation.valid) {
      invalid(`The context evidence is invalid: ${evidence.receiptId}`);
    }
    if (evidenceIds.has(evidence.receiptId)) {
      invalid(`The context receipt ID is duplicated: ${evidence.receiptId}`);
    }
    evidenceIds.add(evidence.receiptId);
    evidenceById.set(evidence.receiptId, evidence);
    if (
      evidence.projectId !== loaded.plan.coordinates.projectId ||
      evidence.runId !== loaded.plan.coordinates.runId ||
      evidence.sessionId !== loaded.plan.coordinates.sessionId
    ) {
      invalid(`The evidence has different run coordinates: ${evidence.receiptId}`);
    }
    if (evidence.state === "loaded") {
      if (loadedEvidence.has(evidence.documentId)) {
        invalid(`The document has duplicate E2 evidence: ${evidence.documentId}`);
      }
      loadedEvidence.set(evidence.documentId, evidence);
    } else if (evidence.state === "injected" || evidence.state === "referenced") {
      invalid(`${evidence.state} evidence cannot be included in E2 input.`);
    }
  }

  if (loaded.evidence.length !== loaded.plan.evidence.length + loaded.documents.length) {
    invalid(
      "The LoadedContext evidence count differs from the discovery/recommendation/E1/E2 chain.",
    );
  }
  for (const evidence of loaded.plan.evidence) {
    if (
      evidence.state !== "discovered" &&
      evidence.state !== "recommended" &&
      evidence.state !== "selected"
    ) {
      invalid(
        `A context plan can contain only discovery, recommendation, and E1 evidence: ${evidence.receiptId}`,
      );
    }
    if (!planEvidenceEqual(evidence, evidenceById.get(evidence.receiptId))) {
      invalid(`The context plan evidence changed: ${evidence.receiptId}`);
    }
  }
  for (const document of loaded.documents) {
    const evidence = loadedEvidence.get(document.documentId);
    if (
      evidence === undefined ||
      evidence.recordedAt !== loaded.loadedAt ||
      evidence.contentHash !== document.contentHash ||
      evidence.byteCount !== document.byteCount ||
      evidence.sourceRevision !== document.sourceRevision ||
      !contextScopesEqual(evidence.scope, document.scope) ||
      !metadataEqual(evidence.knowledgeContext, document.knowledgeContext)
    ) {
      invalid(`There is no E2 evidence matching the document: ${document.documentId}`);
    }
  }
}
