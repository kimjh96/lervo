import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { DocumentLifecycleEvidence } from "./document-lifecycle-model.js";

/**
 * The only lifecycle state the relation web cannot rebuild from canonical sources (ADR-0562): the
 * revision through which each document was assessed, and the cadence sweep's daily progress. It
 * lives outside `relation-web.sqlite`, so a web schema change never drops it. Losing it is safe:
 * each document falls back to its own last commit as its baseline, and the sweep starts again.
 */
export const DOCUMENT_LIFECYCLE_RECORD_PATH = ".lervo/state/knowledge/document-lifecycle.json";

const MAXIMUM_RECORD_BYTES = 4 * 1024 * 1024;
export const MAXIMUM_LIFECYCLE_RECORD_DOCUMENTS = 4096;
/** Cached open reasons per document and unknown commands per record are bounded. */
export const MAXIMUM_RECORDED_REASONS = 32;
const MAXIMUM_RECORDED_COMMANDS = 1024;
const revisionPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;

export interface DocumentLifecycleRecordEntry {
  /** `sha256:` hash of the bytes that were assessed; other bytes mean the document changed. */
  contentHash: string;
  /** The revision through which the document is known to match what it names. */
  assessedRevision: string;
  /** When Lervo last evaluated the document, current or not. */
  evaluatedAt: string;
  /**
   * Provider reasons left open from `assessedRevision` to the record's `revision`; a cache that is
   * reused while no later change reaches the document and recomputed when one does.
   */
  reasons?: DocumentLifecycleEvidence[];
}

export interface DocumentLifecycleRecord {
  schemaVersion: 1;
  kind: "document_lifecycle.record";
  /** HEAD at the last recorded evaluation. */
  revision: string | null;
  documents: Record<string, DocumentLifecycleRecordEntry>;
  /** Command mentions the catalog did not know at `revision`; only later ones are new removals. */
  unknownCommands: string[];
  /** Documents the cadence sweep assessed on the UTC `day`. */
  cadence: { day: string; assessed: number };
}

export function emptyDocumentLifecycleRecord(): DocumentLifecycleRecord {
  return {
    schemaVersion: 1,
    kind: "document_lifecycle.record",
    revision: null,
    documents: {},
    unknownCommands: [],
    cadence: { day: "", assessed: 0 },
  };
}

function validEntry(value: unknown): value is DocumentLifecycleRecordEntry {
  const entry = value as Partial<DocumentLifecycleRecordEntry> | null;
  return (
    typeof entry?.contentHash === "string" &&
    typeof entry.assessedRevision === "string" &&
    revisionPattern.test(entry.assessedRevision) &&
    typeof entry.evaluatedAt === "string" &&
    Number.isFinite(Date.parse(entry.evaluatedAt)) &&
    (entry.reasons === undefined ||
      (Array.isArray(entry.reasons) &&
        entry.reasons.length <= MAXIMUM_RECORDED_REASONS &&
        entry.reasons.every(
          (reason) => typeof reason?.reason === "string" && typeof reason.target === "string",
        )))
  );
}

/** A missing, oversized, or malformed record reads as empty, never as an error. */
export async function readDocumentLifecycleRecord(root: string): Promise<DocumentLifecycleRecord> {
  const path = resolve(root, DOCUMENT_LIFECYCLE_RECORD_PATH);
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAXIMUM_RECORD_BYTES) return emptyDocumentLifecycleRecord();
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<DocumentLifecycleRecord>;
    if (
      value.schemaVersion !== 1 ||
      value.kind !== "document_lifecycle.record" ||
      (value.revision !== null && typeof value.revision !== "string") ||
      typeof value.documents !== "object" ||
      value.documents === null ||
      typeof value.cadence?.day !== "string" ||
      !Number.isSafeInteger(value.cadence.assessed)
    )
      return emptyDocumentLifecycleRecord();
    const documents: Record<string, DocumentLifecycleRecordEntry> = {};
    for (const [documentPath, entry] of Object.entries(value.documents).slice(
      0,
      MAXIMUM_LIFECYCLE_RECORD_DOCUMENTS,
    ))
      if (validEntry(entry)) documents[documentPath] = entry;
    return {
      schemaVersion: 1,
      kind: "document_lifecycle.record",
      revision: value.revision ?? null,
      documents,
      unknownCommands: Array.isArray(value.unknownCommands)
        ? value.unknownCommands
            .filter((command): command is string => typeof command === "string")
            .slice(0, MAXIMUM_RECORDED_COMMANDS)
        : [],
      cadence: { day: value.cadence.day, assessed: value.cadence.assessed },
    };
  } catch {
    return emptyDocumentLifecycleRecord();
  }
}

/** Replaces the record atomically with mode 0600; entries are bounded by the caller's documents. */
export async function writeDocumentLifecycleRecord(
  root: string,
  record: DocumentLifecycleRecord,
): Promise<void> {
  const path = resolve(root, DOCUMENT_LIFECYCLE_RECORD_PATH);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const documents = Object.fromEntries(
    Object.entries(record.documents)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .slice(0, MAXIMUM_LIFECYCLE_RECORD_DOCUMENTS),
  );
  try {
    const unknownCommands = record.unknownCommands.slice(0, MAXIMUM_RECORDED_COMMANDS);
    await writeFile(temporary, `${JSON.stringify({ ...record, documents, unknownCommands })}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    await chmod(temporary, 0o600);
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}
