import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  DOCUMENT_ROUTE_CLASSIFICATION_CONTRACT,
  DOCUMENT_ROUTE_CLASSIFICATION_TASK,
  type DocumentRouteClassificationRequest,
  type DocumentRouteOutcome,
  type DocumentRouteSubject,
  type DocumentRouteVerdict,
} from "./document-route-classification-contract.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";

/**
 * Host-private semantic classification evidence (ADR-0476). It is never canonical: the reviewed
 * move it enables is recorded in source lineage and the materialization event, and a lost record
 * only returns its document to the deferred state.
 */
export const documentRouteClassificationStatePath =
  ".lervo/state/knowledge/document-route-classifications.json";
const MAXIMUM_RECORDS = 4096;
const MAXIMUM_STATE_BYTES = 16 * 1024 * 1024;

export interface DocumentRouteClassificationRecord {
  schemaVersion: 1;
  classificationId: string;
  subject: DocumentRouteSubject;
  path: string;
  contentHash: string;
  taxonomyId: string;
  routeSetDigest: string;
  outcome: DocumentRouteOutcome;
  routeId: string | null;
  roleId: string | null;
  rationale: string;
  evidence: {
    basis: "semantic_provider";
    provider: "codex" | "claude";
    adapterId: string;
    contract: typeof DOCUMENT_ROUTE_CLASSIFICATION_CONTRACT;
    task: typeof DOCUMENT_ROUTE_CLASSIFICATION_TASK;
    requestDigest: string;
    responseDigest: string;
    /** The content-addressed provider observation, when the caller retained one. */
    observationArtifactHash: string | null;
  };
  classifiedAt: string;
}

export function documentRouteClassificationId(input: {
  subject: DocumentRouteSubject;
  path: string;
  contentHash: string;
  routeSetDigest: string;
}): string {
  return stableId("kdroute", input);
}

/** The digest a plan move cites so the exact classification it relied on stays auditable. */
export function documentRouteClassificationDigest(
  record: DocumentRouteClassificationRecord,
): string {
  return sha256(canonicalJson(record));
}

function validRecord(value: unknown): value is DocumentRouteClassificationRecord {
  const record = value as Partial<DocumentRouteClassificationRecord> | null;
  return (
    record !== null &&
    typeof record === "object" &&
    record.schemaVersion === 1 &&
    typeof record.path === "string" &&
    typeof record.contentHash === "string" &&
    typeof record.routeSetDigest === "string" &&
    (record.subject === "document" ||
      record.subject === "decision" ||
      record.subject === "instruction") &&
    record.classificationId ===
      documentRouteClassificationId({
        subject: record.subject,
        path: record.path,
        contentHash: record.contentHash,
        routeSetDigest: record.routeSetDigest,
      }) &&
    (record.outcome === "route"
      ? typeof record.routeId === "string" && record.roleId === null
      : record.outcome === "role"
        ? typeof record.roleId === "string" && record.routeId === null
        : (record.outcome === "retain_in_place" || record.outcome === "uncertain") &&
          record.routeId === null &&
          record.roleId === null) &&
    record.evidence?.basis === "semantic_provider" &&
    record.evidence.contract === DOCUMENT_ROUTE_CLASSIFICATION_CONTRACT
  );
}

/** Unreadable or malformed evidence yields no record, so a document defers instead of routing. */
export async function loadDocumentRouteClassifications(
  repositoryRoot: string,
): Promise<Map<string, DocumentRouteClassificationRecord>> {
  const path = resolve(repositoryRoot, documentRouteClassificationStatePath);
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.size > MAXIMUM_STATE_BYTES) return new Map();
    const value = JSON.parse(await readFile(path, "utf8")) as { records?: unknown };
    const records = Array.isArray(value.records) ? value.records.filter(validRecord) : [];
    return new Map(records.map((record) => [record.classificationId, record]));
  } catch {
    return new Map();
  }
}

export function createDocumentRouteClassificationRecords(input: {
  request: DocumentRouteClassificationRequest;
  requestDigest: string;
  verdicts: readonly DocumentRouteVerdict[];
  provider: "codex" | "claude";
  responseDigest: string;
  observationArtifactHash: string | null;
  classifiedAt: Date;
}): DocumentRouteClassificationRecord[] {
  return input.verdicts.map((verdict) => {
    const document = input.request.documents.find((item) => item.path === verdict.path)!;
    return {
      schemaVersion: 1,
      classificationId: documentRouteClassificationId({
        subject: document.subject,
        path: document.path,
        contentHash: document.contentHash,
        routeSetDigest: input.request.routeSetDigest,
      }),
      subject: document.subject,
      path: document.path,
      contentHash: document.contentHash,
      taxonomyId: input.request.taxonomyId,
      routeSetDigest: input.request.routeSetDigest,
      outcome: verdict.outcome,
      routeId: verdict.routeId,
      roleId: verdict.roleId,
      rationale: verdict.rationale,
      evidence: {
        basis: "semantic_provider",
        provider: input.provider,
        adapterId: `${input.provider}/no-capability-json`,
        contract: DOCUMENT_ROUTE_CLASSIFICATION_CONTRACT,
        task: DOCUMENT_ROUTE_CLASSIFICATION_TASK,
        requestDigest: input.requestDigest,
        responseDigest: input.responseDigest,
        observationArtifactHash: input.observationArtifactHash,
      },
      classifiedAt: input.classifiedAt.toISOString(),
    };
  });
}

/**
 * Adds new records and keeps only those still bound to a live document, so the state stays
 * bounded by the repository's current deferred documents rather than by classification history.
 */
export async function recordDocumentRouteClassifications(input: {
  repositoryRoot: string;
  records: readonly DocumentRouteClassificationRecord[];
  liveClassificationIds: ReadonlySet<string>;
}): Promise<void> {
  const current = await loadDocumentRouteClassifications(input.repositoryRoot);
  for (const record of input.records) current.set(record.classificationId, record);
  const kept = [...current.values()]
    .filter(
      (record) =>
        input.liveClassificationIds.has(record.classificationId) ||
        input.records.some((item) => item.classificationId === record.classificationId),
    )
    .sort((left, right) => right.classifiedAt.localeCompare(left.classifiedAt))
    .slice(0, MAXIMUM_RECORDS)
    .sort((left, right) => left.classificationId.localeCompare(right.classificationId));
  const path = resolve(input.repositoryRoot, documentRouteClassificationStatePath);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify({ schemaVersion: 1, records: kept })}\n`, {
      flag: "wx",
    });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
