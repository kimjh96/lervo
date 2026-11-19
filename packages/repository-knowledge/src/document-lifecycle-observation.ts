import { lstat, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { DocumentFreshnessAssessmentV1 } from "./document-freshness-assessment.js";
import {
  evaluateDocumentLifecycle,
  type DocumentLifecycleEvaluation,
} from "./document-lifecycle-evaluation.js";
import { gitDocumentLifecyclePort } from "./document-lifecycle-git.js";
import {
  readDocumentLifecycleRecord,
  writeDocumentLifecycleRecord,
} from "./document-lifecycle-record.js";
import { buildRepositoryRelationWeb, relationWebStorePath } from "./relation-web-refresh.js";
import { writeRelationWebStore } from "./relation-web-store.js";
import type { RelationWeb } from "./relation-web.js";

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

export interface DocumentLifecycleObservation {
  web: RelationWeb;
  evaluation: DocumentLifecycleEvaluation;
}

/**
 * ADR-0562: builds the relation web and evaluates the document lifecycle of `documents`. Only
 * `evaluate_and_record` writes: the web with its lifecycle rows in one transaction, then the
 * lifecycle record. The web keeps the command catalog it has; the CLI supplies its catalog when it
 * refreshes the web. A failure is thrown; the staleness report then carries no lifecycle counts.
 */
export async function observeDocumentLifecycle(input: {
  root: string;
  mode: "evaluate" | "evaluate_and_record";
  documents: readonly string[];
  assessments: readonly DocumentFreshnessAssessmentV1[];
  now: Date;
}): Promise<DocumentLifecycleObservation> {
  const { web } = await buildRepositoryRelationWeb(input.root, { commands: "stored" });
  const evaluation = await evaluateDocumentLifecycle({
    web,
    record: await readDocumentLifecycleRecord(input.root),
    git: gitDocumentLifecyclePort(input.root),
    now: input.now,
    readDocument: (path) => readDocument(input.root, path),
    assessments: input.assessments,
    documents: new Set(input.documents),
  });
  if (input.mode === "evaluate_and_record") {
    writeRelationWebStore(await relationWebStorePath(input.root), web, input.now.toISOString(), [
      ...evaluation.entries.values(),
    ]);
    await writeDocumentLifecycleRecord(input.root, evaluation.record);
  }
  return { web, evaluation };
}
