import { createHash } from "node:crypto";

import {
  contextScopesEqual,
  type ContextEvidence,
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
  const key = (reason: ContextSelectionReason): string =>
    `${reason.reasonCode}\0${reason.ruleId}`;
  return stringSetsEqual(left.map(key), right.map(key));
}

function planEvidenceEqual(
  left: PlanEvidence,
  right: ContextEvidence | undefined,
): boolean {
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
    return left.path === right.path;
  }
  if (left.state === "recommended" && right.state === "recommended") {
    return left.recommendationId === right.recommendationId &&
      left.batchId === right.batchId && left.sourceAttemptId === right.sourceAttemptId &&
      left.engineId === right.engineId && left.engineVersion === right.engineVersion &&
      left.indexId === right.indexId && left.resultSetHash === right.resultSetHash &&
      left.sourceContentHash === right.sourceContentHash && left.rank === right.rank &&
      left.score === right.score && left.selectionPolicyId === right.selectionPolicyId &&
      left.selectionPolicyVersion === right.selectionPolicyVersion &&
      left.selectionMaximum === right.selectionMaximum;
  }
  return (
    left.state === "selected" &&
    right.state === "selected" &&
    left.required === right.required &&
    contextScopesEqual(left.scope, right.scope) &&
    left.policyVersion === right.policyVersion &&
    left.reasonCode === right.reasonCode &&
    left.ruleId === right.ruleId
  );
}

export function assertLoadedContextIntegrity(loaded: LoadedContext): void {
  try {
    validateContextPlanForLoading(loaded.plan);
  } catch (error) {
    invalid("E2 context plan이 유효하지 않습니다.", error);
  }
  const planCreatedAt = Date.parse(loaded.plan.createdAt);
  const loadedAt = Date.parse(loaded.loadedAt);
  if (
    !Number.isFinite(planCreatedAt) ||
    !Number.isFinite(loadedAt) ||
    loadedAt < planCreatedAt
  ) {
    invalid("LoadedContext의 plan/E2 시간 순서가 유효하지 않습니다.");
  }
  if (loaded.documents.length !== loaded.plan.documents.length) {
    invalid("E2 문서 수가 context plan과 다릅니다.");
  }

  const loadedDocuments = new Map(
    loaded.documents.map((document) => [document.documentId, document]),
  );
  if (loadedDocuments.size !== loaded.documents.length) {
    invalid("LoadedContext에 중복 문서 ID가 있습니다.");
  }
  for (const planned of loaded.plan.documents) {
    const document = loadedDocuments.get(planned.documentId);
    if (
      document === undefined ||
      document.path !== planned.path ||
      document.required !== planned.required ||
      !contextScopesEqual(document.scope, planned.scope) ||
      !reasonsEqual(document.reasons, planned.reasons) ||
      !stringSetsEqual(document.sharedContextIds, planned.sharedContextIds) ||
      document.expectedContentHash !== planned.expectedContentHash
    ) {
      invalid(`E2 문서가 context plan과 다릅니다: ${planned.documentId}`);
    }
    if (
      document.byteCount !== document.bytes.byteLength ||
      document.contentHash !== hash(document.bytes) ||
      document.sourceRevision.length === 0 ||
      (document.expectedContentHash !== undefined &&
        document.expectedContentHash !== document.contentHash)
    ) {
      invalid(`E2 문서 bytes와 증거가 일치하지 않습니다: ${document.documentId}`);
    }
  }

  const evidenceIds = new Set<string>();
  const loadedEvidence = new Map<string, LoadedEvidence>();
  const evidenceById = new Map<string, ContextEvidence>();
  for (const evidence of loaded.evidence) {
    const validation = validateSchema("contextEvidence", evidence);
    if (!validation.valid) {
      invalid(`유효하지 않은 context evidence입니다: ${evidence.receiptId}`);
    }
    if (evidenceIds.has(evidence.receiptId)) {
      invalid(`중복 context receipt ID입니다: ${evidence.receiptId}`);
    }
    evidenceIds.add(evidence.receiptId);
    evidenceById.set(evidence.receiptId, evidence);
    if (
      evidence.projectId !== loaded.plan.coordinates.projectId ||
      evidence.runId !== loaded.plan.coordinates.runId ||
      evidence.sessionId !== loaded.plan.coordinates.sessionId
    ) {
      invalid(`다른 실행 좌표의 evidence입니다: ${evidence.receiptId}`);
    }
    if (evidence.state === "loaded") {
      if (loadedEvidence.has(evidence.documentId)) {
        invalid(`문서의 E2 evidence가 중복되었습니다: ${evidence.documentId}`);
      }
      loadedEvidence.set(evidence.documentId, evidence);
    } else if (evidence.state === "injected" || evidence.state === "referenced") {
      invalid(`E2 입력에 ${evidence.state} evidence를 넣을 수 없습니다.`);
    }
  }

  if (loaded.evidence.length !== loaded.plan.evidence.length + loaded.documents.length) {
    invalid("LoadedContext evidence 수가 discovery/recommendation/E1/E2 체인과 다릅니다.");
  }
  for (const evidence of loaded.plan.evidence) {
    if (evidence.state !== "discovered" && evidence.state !== "recommended" &&
      evidence.state !== "selected") {
      invalid(`Context plan에는 discovery·recommendation·E1 evidence만 포함할 수 있습니다: ${evidence.receiptId}`);
    }
    if (!planEvidenceEqual(evidence, evidenceById.get(evidence.receiptId))) {
      invalid(`Context plan evidence가 변경되었습니다: ${evidence.receiptId}`);
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
      !contextScopesEqual(evidence.scope, document.scope)
    ) {
      invalid(`문서와 일치하는 E2 evidence가 없습니다: ${document.documentId}`);
    }
  }
}
