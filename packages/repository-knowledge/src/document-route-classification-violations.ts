import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { DocumentRouteClassificationRequest } from "./document-route-classification-contract.js";
import { documentRouteClassificationId } from "./document-route-classification-store.js";

/**
 * ADR-0604: host-private record of route classification answers that broke their contract. A
 * malformed answer is never a verdict, so the documents stay pending; this record only makes them
 * visible as `classification_invalid` attention until a later answer classifies them. Each entry is
 * bound to the exact bytes and route set, so a changed document starts clean.
 */
export const documentRouteClassificationViolationStatePath =
  ".lervo/state/knowledge/document-route-classification-violations.json";
const MAXIMUM_VIOLATIONS = 4096;
const MAXIMUM_STATE_BYTES = 4 * 1024 * 1024;

export const DOCUMENT_ROUTE_CLASSIFICATION_VIOLATION_CODE = "knowledge_semantic_review_invalid";

export interface DocumentRouteClassificationViolation {
  schemaVersion: 1;
  classificationId: string;
  path: string;
  code: typeof DOCUMENT_ROUTE_CLASSIFICATION_VIOLATION_CODE;
  /** How many answers for these exact bytes and routes broke the contract. */
  count: number;
  requestDigest: string;
  firstObservedAt: string;
  lastObservedAt: string;
}

function validViolation(value: unknown): value is DocumentRouteClassificationViolation {
  const item = value as Partial<DocumentRouteClassificationViolation> | null;
  return (
    item !== null &&
    typeof item === "object" &&
    item.schemaVersion === 1 &&
    typeof item.classificationId === "string" &&
    typeof item.path === "string" &&
    item.code === DOCUMENT_ROUTE_CLASSIFICATION_VIOLATION_CODE &&
    Number.isInteger(item.count) &&
    item.count! >= 1 &&
    typeof item.requestDigest === "string" &&
    typeof item.firstObservedAt === "string" &&
    typeof item.lastObservedAt === "string"
  );
}

/** Unreadable state yields no violation, so a document reads as plainly pending. */
export async function loadDocumentRouteClassificationViolations(
  repositoryRoot: string,
): Promise<Map<string, DocumentRouteClassificationViolation>> {
  const path = resolve(repositoryRoot, documentRouteClassificationViolationStatePath);
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.size > MAXIMUM_STATE_BYTES) return new Map();
    const value = JSON.parse(await readFile(path, "utf8")) as { violations?: unknown };
    const violations = Array.isArray(value.violations)
      ? value.violations.filter(validViolation)
      : [];
    return new Map(violations.map((item) => [item.classificationId, item]));
  } catch {
    return new Map();
  }
}

/**
 * Counts one contract violation for every document of the request and keeps only entries still
 * bound to a live deferred document, so the state stays bounded by the current deferrals.
 */
export async function recordDocumentRouteClassificationViolation(input: {
  repositoryRoot: string;
  request: DocumentRouteClassificationRequest;
  requestDigest: string;
  liveClassificationIds: ReadonlySet<string>;
  observedAt: Date;
}): Promise<DocumentRouteClassificationViolation[]> {
  const current = await loadDocumentRouteClassificationViolations(input.repositoryRoot);
  const observedAt = input.observedAt.toISOString();
  const recorded = input.request.documents.map((document) => {
    const classificationId = documentRouteClassificationId({
      subject: document.subject,
      path: document.path,
      contentHash: document.contentHash,
      routeSetDigest: input.request.routeSetDigest,
    });
    const prior = current.get(classificationId);
    const violation: DocumentRouteClassificationViolation = {
      schemaVersion: 1,
      classificationId,
      path: document.path,
      code: DOCUMENT_ROUTE_CLASSIFICATION_VIOLATION_CODE,
      count: (prior?.count ?? 0) + 1,
      requestDigest: input.requestDigest,
      firstObservedAt: prior?.firstObservedAt ?? observedAt,
      lastObservedAt: observedAt,
    };
    current.set(classificationId, violation);
    return violation;
  });
  const fresh = new Set(recorded.map((item) => item.classificationId));
  const kept = [...current.values()]
    .filter(
      (item) =>
        input.liveClassificationIds.has(item.classificationId) || fresh.has(item.classificationId),
    )
    .sort((left, right) => right.lastObservedAt.localeCompare(left.lastObservedAt))
    .slice(0, MAXIMUM_VIOLATIONS)
    .sort((left, right) => left.classificationId.localeCompare(right.classificationId));
  const path = resolve(input.repositoryRoot, documentRouteClassificationViolationStatePath);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, violations: kept })}\n`, {
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
  return recorded;
}
