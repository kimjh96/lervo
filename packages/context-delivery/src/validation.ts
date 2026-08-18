import { createHash } from "node:crypto";

import {
  type LoadedContext,
  validateContextPlanForLoading,
} from "@roven/context";
import {
  type AdapterSession,
  type ContextEvidence,
  type ContextScope,
  validateSchema,
} from "@roven/schemas";

import { ContextDeliveryError } from "./types.js";

export function hashBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function sameScope(left: ContextScope, right: ContextScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "full" || right.kind === "full") return true;
  return (
    left.sections.length === right.sections.length &&
    left.sections.every((section) => right.sections.includes(section))
  );
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function invalidLoaded(message: string, cause?: unknown): never {
  throw new ContextDeliveryError(
    "invalid_loaded_context",
    "contract_validation_failed",
    message,
    cause === undefined ? undefined : { cause },
  );
}

export function validateSession(session: AdapterSession): void {
  const validation = validateSchema("adapter", session);
  if (!validation.valid || session.kind !== "session") {
    throw new ContextDeliveryError(
      "invalid_session",
      "contract_validation_failed",
      "유효한 managed adapter session이 필요합니다.",
      { cause: validation.errors },
    );
  }
}

export function validateLoadedContext(loaded: LoadedContext): void {
  try {
    validateContextPlanForLoading(loaded.plan);
  } catch (error) {
    invalidLoaded("E2 context plan이 유효하지 않습니다.", error);
  }

  if (!Number.isFinite(Date.parse(loaded.loadedAt))) {
    invalidLoaded("LoadedContext의 loadedAt이 유효하지 않습니다.");
  }
  if (loaded.documents.length !== loaded.plan.documents.length) {
    invalidLoaded("E2 문서 수가 context plan과 다릅니다.");
  }

  const plannedIds = new Set<string>();
  const loadedIds = new Set<string>();
  for (const document of loaded.plan.documents) {
    if (plannedIds.has(document.documentId)) {
      invalidLoaded(`Context plan에 중복 문서 ID가 있습니다: ${document.documentId}`);
    }
    plannedIds.add(document.documentId);
  }

  for (let index = 0; index < loaded.documents.length; index += 1) {
    const document = loaded.documents[index]!;
    const planned = loaded.plan.documents[index]!;
    if (loadedIds.has(document.documentId)) {
      invalidLoaded(`LoadedContext에 중복 문서 ID가 있습니다: ${document.documentId}`);
    }
    loadedIds.add(document.documentId);
    if (
      document.documentId !== planned.documentId ||
      document.path !== planned.path ||
      document.required !== planned.required ||
      !sameScope(document.scope, planned.scope) ||
      !sameJson(document.reasons, planned.reasons) ||
      !sameJson(document.sharedContextIds, planned.sharedContextIds) ||
      document.expectedContentHash !== planned.expectedContentHash
    ) {
      invalidLoaded(`E2 문서가 context plan과 다릅니다: ${document.documentId}`);
    }
    if (
      document.byteCount !== document.bytes.byteLength ||
      document.contentHash !== hashBytes(document.bytes) ||
      document.sourceRevision.length === 0 ||
      (document.expectedContentHash !== undefined &&
        document.expectedContentHash !== document.contentHash)
    ) {
      invalidLoaded(`E2 문서 bytes와 증거가 일치하지 않습니다: ${document.documentId}`);
    }
  }

  const evidenceIds = new Set<string>();
  const loadedEvidence = new Map<string, Extract<ContextEvidence, { state: "loaded" }>>();
  for (const evidence of loaded.evidence) {
    const validation = validateSchema("contextEvidence", evidence);
    if (!validation.valid) {
      invalidLoaded(`유효하지 않은 context evidence입니다: ${evidence.receiptId}`);
    }
    if (evidenceIds.has(evidence.receiptId)) {
      invalidLoaded(`중복 context receipt ID입니다: ${evidence.receiptId}`);
    }
    evidenceIds.add(evidence.receiptId);
    if (
      evidence.projectId !== loaded.plan.coordinates.projectId ||
      evidence.runId !== loaded.plan.coordinates.runId ||
      evidence.sessionId !== loaded.plan.coordinates.sessionId
    ) {
      invalidLoaded(`다른 실행 좌표의 evidence입니다: ${evidence.receiptId}`);
    }
    if (evidence.state === "loaded") {
      if (loadedEvidence.has(evidence.documentId)) {
        invalidLoaded(`문서의 E2 evidence가 중복되었습니다: ${evidence.documentId}`);
      }
      loadedEvidence.set(evidence.documentId, evidence);
    } else if (evidence.state === "injected" || evidence.state === "referenced") {
      invalidLoaded(`E2 입력에 ${evidence.state} evidence를 넣을 수 없습니다.`);
    }
  }

  if (loaded.evidence.length !== loaded.plan.evidence.length + loaded.documents.length) {
    invalidLoaded("LoadedContext evidence 수가 E0/E1/E2 체인과 다릅니다.");
  }
  const evidenceById = new Map(loaded.evidence.map((item) => [item.receiptId, item]));
  for (const evidence of loaded.plan.evidence) {
    if (!sameJson(evidenceById.get(evidence.receiptId), evidence)) {
      invalidLoaded(`Context plan evidence가 변경되었습니다: ${evidence.receiptId}`);
    }
  }
  for (const document of loaded.documents) {
    const evidence = loadedEvidence.get(document.documentId);
    if (
      evidence === undefined ||
      evidence.contentHash !== document.contentHash ||
      evidence.byteCount !== document.byteCount ||
      evidence.sourceRevision !== document.sourceRevision ||
      !sameScope(evidence.scope, document.scope)
    ) {
      invalidLoaded(`문서와 일치하는 E2 evidence가 없습니다: ${document.documentId}`);
    }
  }
}

export function assertSessionCoordinates(
  loaded: LoadedContext,
  session: AdapterSession,
): void {
  const coordinates = loaded.plan.coordinates;
  if (
    coordinates.projectId !== session.projectId ||
    coordinates.runId !== session.runId ||
    coordinates.sessionId !== session.sessionId ||
    coordinates.roleId !== session.roleId
  ) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "contract_validation_failed",
      "LoadedContext와 adapter session의 project/run/session/role 좌표가 다릅니다.",
    );
  }
}

export function assertGeneration(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new ContextDeliveryError(
      "invalid_delivery_request",
      "contract_validation_failed",
      `${label}은 0 이상의 안전한 정수여야 합니다.`,
    );
  }
}
