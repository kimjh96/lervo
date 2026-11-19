import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { DOCUMENT_LIFECYCLE_EVALUATOR } from "./document-lifecycle-model.js";
import { observeDocumentLifecycle } from "./document-lifecycle-observation.js";
import {
  DOCUMENT_STALENESS_EVALUATOR,
  evaluateRepositoryDocumentStaleness,
  type DocumentStalenessInput,
  type DocumentStalenessReport,
} from "./document-staleness-evaluation.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { readDocumentFreshnessAssessments } from "./document-freshness-assessment-store.js";
import { loadRepositoryKnowledgePolicy } from "./policy.js";
import { currentWorkingFreshnessAssessments } from "./document-freshness-assessment-working-state.js";

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
  coverage: DocumentStalenessReport["coverage"];
  retentionDigest: string | null;
  head: string;
  now: Date;
  documents: DocumentStalenessInput["documents"];
  normalizationRecords: DocumentStalenessInput["normalizationRecords"];
  assessmentHashes: string[];
  assessmentPolicyHash: string;
}): string {
  return sha256(
    canonicalJson({
      evaluator: DOCUMENT_STALENESS_EVALUATOR,
      // ADR-0562: the lifecycle counts ride on the report, so its rules version the reading too.
      lifecycle: DOCUMENT_LIFECYCLE_EVALUATOR,
      assessmentHashes: input.assessmentHashes,
      assessmentPolicyHash: input.assessmentPolicyHash,
      head: input.head,
      coverage: input.coverage,
      retention: input.retentionDigest,
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
      value.report.evaluator !== DOCUMENT_STALENESS_EVALUATOR ||
      value.report.coverage !== "complete"
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
 *
 * ADR-0562 shadow: with complete coverage, the document lifecycle is evaluated beside this report
 * and its counts are attached; the findings still come from the ADR-0023 evaluator. Switching the
 * findings to the lifecycle is a later decision (core loop roadmap item 8), because it also
 * replaces the review-interval policy.
 */
export async function observeRepositoryDocumentStaleness(
  input: DocumentStalenessInput & {
    root: string;
    mode: DocumentStalenessObservationMode;
    /** ADR-0544 retention digest of the scan that supplied the documents. */
    retentionDigest?: string;
  },
): Promise<DocumentStalenessReport> {
  const head = await input.git.headRevision().catch(() => null);
  const assessmentRecords = await currentWorkingFreshnessAssessments(
    input.root,
    await readDocumentFreshnessAssessments(input.root),
  );
  const assessmentPolicyHash = sha256(
    canonicalJson(await loadRepositoryKnowledgePolicy(input.root)),
  );
  const coordinate =
    head === null
      ? null
      : observationCoordinate({
          coverage: input.coverage,
          retentionDigest: input.retentionDigest ?? null,
          head,
          now: input.now,
          documents: input.documents,
          normalizationRecords: input.normalizationRecords,
          assessmentHashes: assessmentRecords.map((item) => item.receiptHash).sort(),
          assessmentPolicyHash,
        });
  if (coordinate !== null) {
    const state = await readState(input.root);
    if (state?.coordinate === coordinate) return state.report;
  }
  const assessments = assessmentRecords.map((item) => item.assessment);
  const evaluated = await evaluateRepositoryDocumentStaleness({
    ...input,
    assessments,
    assessmentPolicyHash,
  });
  const lifecycle =
    input.coverage === "complete" ? await lifecycleSummary(input, assessments) : null;
  const report = lifecycle === null ? evaluated : { ...evaluated, lifecycle };
  if (
    input.mode === "evaluate_and_record" &&
    coordinate !== null &&
    report.status === "observed" &&
    report.coverage === "complete"
  )
    await writeState(input.root, { schemaVersion: 1, coordinate, report }).catch(() => undefined);
  return report;
}

/**
 * ADR-0562 lifecycle counts, or null when the relation web or the lifecycle cannot be evaluated;
 * the report then carries no lifecycle until an observation with a new coordinate tries again.
 */
async function lifecycleSummary(
  input: Pick<DocumentStalenessInput, "documents" | "now"> & {
    root: string;
    mode: DocumentStalenessObservationMode;
  },
  assessments: Parameters<typeof observeDocumentLifecycle>[0]["assessments"],
): Promise<NonNullable<DocumentStalenessReport["lifecycle"]> | null> {
  try {
    const observation = await observeDocumentLifecycle({
      root: input.root,
      mode: input.mode,
      documents: input.documents.map((document) => document.path),
      assessments,
      now: input.now,
    });
    return observation.evaluation.summary;
  } catch {
    return null;
  }
}
