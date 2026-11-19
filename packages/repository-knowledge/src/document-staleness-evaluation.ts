import type { DocumentLifecycleSummary } from "./document-lifecycle-model.js";
import type { RepositoryKnowledgeScan } from "./types.js";
import {
  evaluateDocumentStaleness,
  type DocumentStalenessRepositorySnapshot,
} from "@lervo/documents";
import type { DocumentManifest } from "@lervo/schemas";

import { extractDocumentReferences } from "./document-references.js";
import type { DocumentStalenessGitPort } from "./document-staleness-git.js";
import { sha256, stableId } from "./integrity.js";
import {
  documentFreshnessAssessmentMatches,
  type DocumentFreshnessAssessmentV1,
} from "./document-freshness-assessment.js";

export const DOCUMENT_STALENESS_EVALUATOR = "lervo.document-staleness.v1" as const;
/** Review interval for inferred manifests; code drift, not age, is the primary signal. */
export const INFERRED_REVIEW_INTERVAL_DAYS = 365;
export const MAXIMUM_CONNECTED_PATHS = 32;
export const MAXIMUM_REPORTED_DOCUMENTS = 256;
export const MAXIMUM_EVALUATED_DOCUMENTS = 4096;

export type DocumentStalenessStatus = "current" | "stale" | "unknown";

export interface DocumentStalenessFinding {
  path: string;
  status: DocumentStalenessStatus;
  verifiedRevision: string | null;
  /** Evaluator reason names, or `connected_paths_not_inferred` / `document_history_unavailable`. */
  reasons: string[];
  connectedPaths: string[];
  changedPaths: string[];
}

/**
 * Rebuildable staleness projection over every evaluated Markdown document. It contains only
 * repository-relative paths, revisions, and reason names, never document or source content.
 * `stale` and `unknown` are the stable seam for evidence-bound update candidates.
 */
export interface DocumentStalenessReport {
  coverage: RepositoryKnowledgeScan["coverage"];
  schemaVersion: 1;
  kind: "document_staleness.report";
  evaluator: typeof DOCUMENT_STALENESS_EVALUATOR;
  status: "observed" | "unavailable";
  currentRevision: string | null;
  evaluatedAt: string;
  counts: {
    documents: number;
    evaluated: number;
    current: number;
    stale: number;
    unknown: number;
    unevaluated: number;
  };
  stale: DocumentStalenessFinding[];
  unknown: DocumentStalenessFinding[];
  truncated: { stale: number; unknown: number };
  /**
   * ADR-0562 document lifecycle counts, evaluated beside this report when scan coverage is
   * complete. The findings above still come from this evaluator; the lifecycle does not change them.
   */
  lifecycle?: DocumentLifecycleSummary;
}

export interface DocumentStalenessInput {
  coverage: RepositoryKnowledgeScan["coverage"];
  documents: ReadonlyArray<{ path: string; content: string }>;
  normalizationRecords: ReadonlyArray<{ path: string; outputPaths: readonly string[] }>;
  /** True when a target is generated, ignored, or rebuildable and must not connect a document. */
  ignored: (target: string) => boolean;
  /** True when the repository root contains this first path segment. */
  topLevel: (segment: string) => boolean;
  git: DocumentStalenessGitPort;
  now: Date;
  assessments?: readonly DocumentFreshnessAssessmentV1[];
  assessmentPolicyHash?: string;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * Deterministic connected-path candidates: references other than Markdown documents, the document
 * itself, its ancestor directories, ignored or generated paths, and weak paths whose first segment
 * is absent at the repository root; sorted and bounded.
 */
export function inferConnectedPathCandidates(input: {
  path: string;
  content: string;
  ignored: (target: string) => boolean;
  topLevel: (segment: string) => boolean;
}): string[] {
  const candidates = new Set<string>();
  for (const reference of extractDocumentReferences(input)) {
    const target = reference.target;
    // A directory containing the document would connect it to its own siblings.
    if (
      target === input.path ||
      input.path.startsWith(`${target}/`) ||
      /\.mdx?$/iu.test(target) ||
      input.ignored(target) ||
      (reference.weak === true && !input.topLevel(target.split("/")[0]!))
    )
      continue;
    candidates.add(target);
  }
  return [...candidates].sort(compare).slice(0, MAXIMUM_CONNECTED_PATHS);
}

function inferredManifest(input: {
  path: string;
  connectedPaths: string[];
  verifiedRevision: string;
  verifiedAt: string;
}): DocumentManifest {
  return {
    schemaVersion: 1,
    documentId: stableId("doc", { path: input.path }),
    record: {
      path: input.path,
      kind: "canonical",
      responsibleParty: { kind: "team", id: "repository" },
      connectedPaths: input.connectedPaths,
      verifiedRevision: input.verifiedRevision,
      verifiedAt: input.verifiedAt,
      reviewIntervalDays: INFERRED_REVIEW_INTERVAL_DAYS,
      ownership: { mode: "user" },
    },
    contentPolicy: {
      mode: "user_managed",
      mediaType: "text/markdown; charset=utf-8",
      profileId: "lervo.inferred-staleness/v1",
      locale: "en",
      audience: "mixed",
      metadataPlacement: "sidecar",
      historyMode: "separate_documents",
      splitStrategy: "topic_documents",
      automaticWrites: false,
      splitRecommendedAtBytes: 32768,
      oversizeReviewAtBytes: 65536,
      overflowAction: "report_split_recommended",
    },
    relations: { supersedesDocumentIds: [], relatedDocumentIds: [] },
  };
}

function snapshot(
  revision: string,
  paths: readonly string[],
  objects: ReadonlyMap<string, string | null>,
): DocumentStalenessRepositorySnapshot {
  const files: Record<string, string> = {};
  for (const path of paths) {
    const object = objects.get(`${revision}:${path}`);
    if (object !== null && object !== undefined) files[path] = sha256(object);
  }
  return { revision, files };
}

function emptyReport(
  status: DocumentStalenessReport["status"],
  now: Date,
  documents: number,
): DocumentStalenessReport {
  return {
    schemaVersion: 1 as const,
    kind: "document_staleness.report" as const,
    evaluator: DOCUMENT_STALENESS_EVALUATOR,
    coverage: "complete",
    status,
    currentRevision: null,
    evaluatedAt: now.toISOString(),
    counts: { documents, evaluated: 0, current: 0, stale: 0, unknown: 0, unevaluated: documents },
    stale: [],
    unknown: [],
    truncated: { stale: 0, unknown: 0 },
  };
}

/**
 * Evaluates every document against the snapshot at its verified revision: the later of the last
 * first-parent commit that changed its bytes and the last commit that changed a tracked
 * normalization record naming it as an output. Uncommitted edits are not evaluated.
 */
export async function evaluateRepositoryDocumentStaleness(
  input: DocumentStalenessInput,
): Promise<DocumentStalenessReport> {
  if (input.coverage !== "complete")
    return {
      ...emptyReport("unavailable", input.now, input.documents.length),
      coverage: "partial",
    };
  const documents = [...input.documents]
    .sort((left, right) => compare(left.path, right.path))
    .slice(0, MAXIMUM_EVALUATED_DOCUMENTS);
  let head: string;
  let history: Awaited<ReturnType<DocumentStalenessGitPort["latestPathRevisions"]>>;
  try {
    head = await input.git.headRevision();
    history = await input.git.latestPathRevisions([
      "*.md",
      "*.mdx",
      ".lervo/knowledge/document-normalizations",
    ]);
  } catch {
    return emptyReport("unavailable", input.now, documents.length);
  }
  const recordsByOutput = new Map<string, string[]>();
  for (const record of input.normalizationRecords)
    for (const output of record.outputPaths)
      recordsByOutput.set(output, [...(recordsByOutput.get(output) ?? []), record.path]);

  const plans: Array<{
    path: string;
    verified: { revision: string; committedAt: string } | null;
    candidates: string[];
  }> = documents.map((document) => {
    const changes = [document.path, ...(recordsByOutput.get(document.path) ?? [])]
      .map((path) => history.get(path))
      .filter((change) => change !== undefined)
      .sort((left, right) => left.order - right.order);
    return {
      path: document.path,
      verified: changes[0] ?? null,
      candidates: inferConnectedPathCandidates({
        path: document.path,
        content: document.content,
        ignored: input.ignored,
        topLevel: input.topLevel,
      }),
    };
  });
  const lookups = new Set<string>();
  for (const assessment of input.assessments ?? [])
    for (const object of assessment.dependency.objects) lookups.add(`${head}:${object.path}`);
  for (const plan of plans) {
    if (plan.verified === null || plan.candidates.length === 0) continue;
    for (const path of [plan.path, ...plan.candidates]) {
      lookups.add(`${head}:${path}`);
      lookups.add(`${plan.verified.revision}:${path}`);
    }
  }
  let objects: Map<string, string | null>;
  try {
    objects = await input.git.objectNames([...lookups].sort(compare));
  } catch {
    return emptyReport("unavailable", input.now, documents.length);
  }

  const findings: DocumentStalenessFinding[] = [];
  let unevaluated = 0;
  for (const plan of plans) {
    if (plan.verified === null) {
      unevaluated += 1;
      continue;
    }
    const verified = plan.verified;
    const connectedPaths = plan.candidates.filter(
      (path) =>
        (objects.get(`${head}:${path}`) ?? null) !== null ||
        (objects.get(`${verified.revision}:${path}`) ?? null) !== null,
    );
    if (connectedPaths.length === 0) {
      unevaluated += 1;
      continue;
    }
    const paths = [plan.path, ...connectedPaths];
    try {
      const verifiedAt = new Date(verified.committedAt);
      const evaluatedAt = input.now < verifiedAt ? verifiedAt : input.now;
      const result = evaluateDocumentStaleness({
        manifest: inferredManifest({
          path: plan.path,
          connectedPaths,
          verifiedRevision: verified.revision,
          verifiedAt: verifiedAt.toISOString(),
        }),
        evaluatedAt: evaluatedAt.toISOString(),
        currentSnapshot: snapshot(head, paths, objects),
        ...(verified.revision === head
          ? {}
          : { verifiedSnapshot: snapshot(verified.revision, paths, objects) }),
      });
      const document = documents.find((item) => item.path === plan.path)!;
      const assessment = input.assessments?.find((item) => item.documentPath === plan.path);
      const assessed =
        result.reasons.every(
          (reason) => reason === "connected_path_changed" || reason === "review_interval_elapsed",
        ) &&
        assessment !== undefined &&
        input.assessmentPolicyHash !== undefined &&
        documentFreshnessAssessmentMatches({
          assessment,
          documentHash: sha256(document.content),
          policyHash: input.assessmentPolicyHash,
          connectedPaths,
          objects,
          revision: head,
          now: input.now,
        });
      findings.push({
        path: plan.path,
        status: assessed ? "current" : result.status,
        verifiedRevision: verified.revision,
        reasons: assessed ? [] : [...result.reasons],
        connectedPaths,
        changedPaths: assessed ? [] : [...result.signals.connectedPaths.changedPaths],
      });
    } catch {
      findings.push({
        path: plan.path,
        status: "unknown",
        verifiedRevision: verified.revision,
        reasons: ["staleness_evidence_inconsistent"],
        connectedPaths,
        changedPaths: [],
      });
    }
  }
  const stale = findings.filter((finding) => finding.status === "stale");
  const unknown = findings.filter((finding) => finding.status === "unknown");
  return {
    schemaVersion: 1,
    kind: "document_staleness.report",
    evaluator: DOCUMENT_STALENESS_EVALUATOR,
    coverage: "complete",
    status: "observed",
    currentRevision: head,
    evaluatedAt: input.now.toISOString(),
    counts: {
      documents: documents.length,
      evaluated: findings.length,
      current: findings.length - stale.length - unknown.length,
      stale: stale.length,
      unknown: unknown.length,
      unevaluated,
    },
    stale: stale.slice(0, MAXIMUM_REPORTED_DOCUMENTS),
    unknown: unknown.slice(0, MAXIMUM_REPORTED_DOCUMENTS),
    truncated: {
      stale: Math.max(0, stale.length - MAXIMUM_REPORTED_DOCUMENTS),
      unknown: Math.max(0, unknown.length - MAXIMUM_REPORTED_DOCUMENTS),
    },
  };
}
