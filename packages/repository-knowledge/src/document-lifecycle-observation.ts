import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { readDocumentFreshnessAssessments } from "./document-freshness-assessment-store.js";
import { currentWorkingFreshnessAssessments } from "./document-freshness-assessment-working-state.js";
import {
  evaluateDocumentLifecycle,
  type DocumentLifecycleEvaluation,
} from "./document-lifecycle-evaluation.js";
import { gitDocumentLifecyclePort } from "./document-lifecycle-git.js";
import type { DocumentLifecycleSummary } from "./document-lifecycle-model.js";
import type { DocumentLifecycleBudget } from "./document-lifecycle-reasons.js";
import {
  readDocumentLifecycleRecord,
  writeDocumentLifecycleRecord,
} from "./document-lifecycle-record.js";
import { readRecordedDocumentStalenessCoordinate } from "./document-staleness-state.js";
import { buildRepositoryRelationWeb, relationWebStorePath } from "./relation-web-refresh.js";
import { writeRelationWebStore } from "./relation-web-store.js";

const MAXIMUM_DOCUMENT_BYTES = 1024 * 1024;

async function readDocument(root: string, path: string): Promise<string | null> {
  try {
    const file = resolve(root, path);
    const info = await lstat(file);
    return info.isFile() && info.size <= MAXIMUM_DOCUMENT_BYTES
      ? await readFile(file, "utf8")
      : null;
  } catch {
    return null;
  }
}

/**
 * The outcome of one recording call:
 *
 * - `skipped_unfenced`: no complete staleness reading is recorded, so there is nothing to fence on.
 * - `skipped_current`: the last recorded evaluation completed for the same staleness coordinate.
 * - `recorded`: the web and the record were written; `deferred` documents wait for a later call,
 *   and the fence stays open until a call completes without deferring.
 */
export type DocumentLifecycleRecording =
  | { status: "skipped_unfenced" | "skipped_current" }
  | { status: "recorded"; evaluation: DocumentLifecycleEvaluation; deferred: number };

/**
 * ADR-0562 shadow lifecycle, run only by the callers that record the staleness reading (the
 * knowledge currency pass and the freshness observation), never by read-only lint. Its fence is
 * the recorded staleness coordinate: HEAD, the scan's document hashes, the UTC day, coverage, and
 * assessments. A call with the same coordinate does nothing, so an unchanged repository rebuilds
 * the web at most once per day. A call that runs builds the web, evaluates within its budget, and
 * writes the web with its lifecycle rows and then the record with its summary. Failures are
 * thrown; callers treat them as a missing shadow reading.
 */
export async function recordDocumentLifecycle(input: {
  root: string;
  now: Date;
  budget?: Partial<DocumentLifecycleBudget>;
}): Promise<DocumentLifecycleRecording> {
  const reading = await readRecordedDocumentStalenessCoordinate(input.root);
  if (reading === null) return { status: "skipped_unfenced" };
  const record = await readDocumentLifecycleRecord(input.root);
  if (record.fence === reading.coordinate) return { status: "skipped_current" };
  const { web } = await buildRepositoryRelationWeb(input.root, { commands: "stored" });
  const assessments = await currentWorkingFreshnessAssessments(
    input.root,
    await readDocumentFreshnessAssessments(input.root),
  );
  const evaluation = await evaluateDocumentLifecycle({
    web,
    record,
    git: gitDocumentLifecyclePort(input.root),
    now: input.now,
    readDocument: (path) => readDocument(input.root, path),
    assessments: assessments.map((item) => item.assessment),
    ...(input.budget === undefined ? {} : { budget: input.budget }),
  });
  writeRelationWebStore(await relationWebStorePath(input.root), web, input.now.toISOString(), [
    ...evaluation.entries.values(),
  ]);
  await writeDocumentLifecycleRecord(input.root, {
    ...evaluation.record,
    fence: evaluation.deferred.size === 0 ? reading.coordinate : null,
    summary: evaluation.summary,
  });
  return { status: "recorded", evaluation, deferred: evaluation.deferred.size };
}

/**
 * The lifecycle counts of the last recorded evaluation and the HEAD it ran at, for read-only
 * callers such as repository health; null when nothing valid is recorded.
 */
export async function readRecordedDocumentLifecycleSummary(
  root: string,
): Promise<{ revision: string; summary: DocumentLifecycleSummary } | null> {
  const record = await readDocumentLifecycleRecord(root);
  return record.revision === null || record.summary === null
    ? null
    : { revision: record.revision, summary: record.summary };
}
