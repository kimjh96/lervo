import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  DOCUMENT_STALENESS_EVALUATOR,
  evaluateRepositoryDocumentStaleness,
  type DocumentStalenessInput,
  type DocumentStalenessReport,
} from "./document-staleness-evaluation.js";
import { canonicalJson, sha256 } from "./integrity.js";

/** Rebuildable projection; never canonical and never tracked. */
export const documentStalenessStatePath = ".lervo/state/knowledge/document-staleness.json";
const MAXIMUM_STATE_BYTES = 4 * 1024 * 1024;

export type DocumentStalenessObservationMode = "evaluate" | "evaluate_and_record";

interface DocumentStalenessState {
  schemaVersion: 1;
  coordinate: string;
  report: DocumentStalenessReport;
}

function observationCoordinate(input: {
  head: string;
  now: Date;
  documents: DocumentStalenessInput["documents"];
  normalizationRecords: DocumentStalenessInput["normalizationRecords"];
}): string {
  return sha256(
    canonicalJson({
      evaluator: DOCUMENT_STALENESS_EVALUATOR,
      head: input.head,
      // The review-interval signal depends on the UTC evaluation day.
      day: input.now.toISOString().slice(0, 10),
      documents: input.documents.map((document) => [document.path, sha256(document.content)]),
      normalizationRecords: input.normalizationRecords.map((record) => [
        record.path,
        [...record.outputPaths].sort(),
      ]),
    }),
  );
}

async function readState(root: string): Promise<DocumentStalenessState | null> {
  const path = resolve(root, documentStalenessStatePath);
  try {
    const stats = await lstat(path);
    if (!stats.isFile() || stats.size > MAXIMUM_STATE_BYTES) return null;
    const value = JSON.parse(await readFile(path, "utf8")) as Partial<DocumentStalenessState>;
    if (
      value.schemaVersion !== 1 ||
      typeof value.coordinate !== "string" ||
      value.report?.kind !== "document_staleness.report" ||
      value.report.evaluator !== DOCUMENT_STALENESS_EVALUATOR
    )
      return null;
    return value as DocumentStalenessState;
  } catch {
    return null;
  }
}

async function writeState(root: string, state: DocumentStalenessState): Promise<void> {
  const path = resolve(root, documentStalenessStatePath);
  const temporary = `${path}.${randomUUID()}.tmp`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(state)}\n`, { flag: "wx" });
    await rename(temporary, path);
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * The last recorded report, for consumers such as evidence-bound update planning. Callers must
 * compare `currentRevision` with the revision they act on; a mismatch means the report is old.
 */
export async function readRecordedDocumentStalenessReport(
  repositoryRoot: string,
): Promise<DocumentStalenessReport | null> {
  return (await readState(resolve(repositoryRoot)))?.report ?? null;
}

/**
 * Returns the staleness report for the current documents, reusing the persisted projection when
 * its coordinate matches. Only `evaluate_and_record` writes, and only `.lervo/state/`.
 */
export async function observeRepositoryDocumentStaleness(
  input: DocumentStalenessInput & { root: string; mode: DocumentStalenessObservationMode },
): Promise<DocumentStalenessReport> {
  const head = await input.git.headRevision().catch(() => null);
  const coordinate =
    head === null
      ? null
      : observationCoordinate({
          head,
          now: input.now,
          documents: input.documents,
          normalizationRecords: input.normalizationRecords,
        });
  if (coordinate !== null) {
    const state = await readState(input.root);
    if (state?.coordinate === coordinate) return state.report;
  }
  const report = await evaluateRepositoryDocumentStaleness(input);
  if (input.mode === "evaluate_and_record" && coordinate !== null && report.status === "observed")
    await writeState(input.root, { schemaVersion: 1, coordinate, report }).catch(() => undefined);
  return report;
}
