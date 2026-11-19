import type { DocumentFreshnessAssessmentV1 } from "./document-freshness-assessment.js";
import type { DocumentLifecycleGitPort } from "./document-lifecycle-git.js";
import {
  DOCUMENT_LIFECYCLE_CADENCE_DAYS,
  documentLifecycleCadencePerDay,
  type DocumentLifecycleEntry,
  type DocumentLifecycleEvidence,
  type DocumentLifecycleState,
} from "./document-lifecycle-model.js";
import {
  findDocumentLifecycleReasons,
  type DocumentLifecycleBudget,
} from "./document-lifecycle-reasons.js";
import {
  MAXIMUM_LIFECYCLE_RECORD_DOCUMENTS,
  MAXIMUM_RECORDED_REASONS,
  type DocumentLifecycleRecord,
} from "./document-lifecycle-record.js";
import { missingReverseHeaders } from "./document-lifecycle-resolution.js";
import {
  summarizeDocumentLifecycle,
  type DocumentLifecycleOutcome,
} from "./document-lifecycle-summary.js";
import { pathNode, type RelationDocument } from "./relation-web-model.js";
import type { RelationWeb } from "./relation-web.js";

const markdownPattern = /\.mdx?$/iu;

export interface DocumentLifecycleEvaluationInput {
  web: RelationWeb;
  record: DocumentLifecycleRecord;
  git: DocumentLifecycleGitPort;
  now: Date;
  /** Current bytes of a document, for name matching; null when unreadable. */
  readDocument: (path: string) => Promise<string | null>;
  /** Recorded `verified_no_change` assessments whose read set is clean in the working tree. */
  assessments?: readonly DocumentFreshnessAssessmentV1[];
  /** Restricts evaluation to these documents; absent evaluates every web document. */
  documents?: ReadonlySet<string>;
  /** Per-call bound on diff groups and wall time; absent uses the defaults below. */
  budget?: Partial<DocumentLifecycleBudget>;
}

/** Diff groups one call may start; each costs a diff, a blob read, and a changed-line diff. */
export const MAXIMUM_DOCUMENT_LIFECYCLE_GROUPS = 32;
/** Wall time after which one call starts no further group. */
export const DOCUMENT_LIFECYCLE_CALL_MILLISECONDS = 20_000;

export interface DocumentLifecycleEvaluation extends DocumentLifecycleOutcome {
  head: string;
  /** Documents left for a later call because this call's budget ran out. */
  deferred: ReadonlySet<string>;
  /** Each evaluated document's baseline: the revision its reasons were computed from. */
  baselines: ReadonlyMap<string, string>;
  /** The record to persist when the caller records this evaluation. */
  record: DocumentLifecycleRecord;
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** Documents the sweep reaches first: those that name code, then canonical ones, then by path. */
function cadencePriority(document: RelationDocument): number {
  const namesCode = document.edges.some(
    (edge) =>
      edge.evidence.strength === "strong" &&
      (edge.kind === "names_package" ||
        edge.kind === "names_command" ||
        ((edge.kind === "names_path" || edge.kind === "links_to") &&
          !markdownPattern.test(edge.to))),
  );
  return (namesCode ? 0 : 2) + (document.role === "canonical_documents" ? 0 : 1);
}

function derivedState(web: RelationWeb, document: RelationDocument): DocumentLifecycleState | null {
  if (web.lineage.some((record) => record.kind === "retired" && record.from === document.path))
    return "retired";
  if (!document.historical) return null;
  return document.status?.startsWith("superseded") === true ? "superseded" : "archived";
}

function supersededParts(web: RelationWeb, document: RelationDocument): string[] {
  const parts = new Set<string>();
  for (const edge of web.inbound.get(pathNode(document.path)) ?? [])
    if (edge.kind === "supersedes_part" && edge.part !== undefined) parts.add(edge.part);
  return [...parts].sort(compare);
}

function cadenceReason(path: string): DocumentLifecycleEvidence {
  return {
    reason: "cadence_due",
    target: pathNode(path),
    edgeKind: "names_path",
    line: 0,
    strength: "strong",
    resolution: "cadence",
  };
}

/** Provider no-change assessments of the current bytes whose dependencies still match HEAD. */
async function matchingAssessments(
  input: DocumentLifecycleEvaluationInput,
  head: string,
): Promise<Map<string, DocumentFreshnessAssessmentV1>> {
  const candidates = (input.assessments ?? []).filter(
    (assessment) =>
      assessment.outcome === "verified_no_change" &&
      input.web.documents.get(assessment.documentPath)?.contentHash === assessment.documentHash,
  );
  const lookups = new Set(
    candidates.flatMap((item) => item.dependency.objects.map((object) => `${head}:${object.path}`)),
  );
  const objects = await input.git.objectNames([...lookups].sort(compare));
  const matching = new Map<string, DocumentFreshnessAssessmentV1>();
  for (const assessment of candidates)
    if (
      assessment.dependency.objects.every(
        (object) => objects.get(`${head}:${object.path}`) === object.objectName,
      )
    )
      matching.set(assessment.documentPath, assessment);
  return matching;
}

/**
 * ADR-0562 document lifecycle over the relation web. A recorded document is evaluated from its
 * assessed revision to HEAD through one reverse lookup per baseline group. A never-assessed
 * document waits for the cadence sweep, which reaches `documentLifecycleCadencePerDay` documents
 * per UTC day, so all are reached within `DOCUMENT_LIFECYCLE_CADENCE_DAYS`; its baseline is its own
 * last commit. Deterministic resolution settles what a change did not touch; mechanical reverse
 * header edits and provider reasons stay open. Only a provider reason or an unavailable
 * evaluation keeps the assessed revision behind HEAD, so open reasons are recomputed from it.
 */
export async function evaluateDocumentLifecycle(
  input: DocumentLifecycleEvaluationInput,
): Promise<DocumentLifecycleEvaluation> {
  const { web, record, git, now } = input;
  const head = await git.headRevision();
  const day = now.toISOString().slice(0, 10);
  const history = await git.latestPathRevisions(["*.md", "*.mdx"]);
  const documents = [...web.documents.values()].filter(
    (document) => input.documents === undefined || input.documents.has(document.path),
  );
  const lastCommit = (path: string) => history.get(path)?.revision ?? null;
  // The record holds the first documents by path; one past the bound can never be recorded as
  // assessed, so the sweep never spends its quota on it and it stays unassessed.
  const recordable = new Set(
    [...web.documents.keys()].sort(compare).slice(0, MAXIMUM_LIFECYCLE_RECORD_DOCUMENTS),
  );
  const perDay = documentLifecycleCadencePerDay(documents.length);
  const assessedBefore = record.cadence.day === day ? record.cadence.assessed : 0;

  const entries = new Map<string, DocumentLifecycleEntry>();
  const baselines = new Map<string, string>();
  const fresh = new Set<string>();
  const reachable: RelationDocument[] = [];
  let withoutHistory = 0;
  let unrecordable = 0;
  for (const document of documents) {
    const recorded = record.documents[document.path];
    const state = derivedState(web, document);
    if (state !== null) {
      entries.set(document.path, {
        path: document.path,
        state,
        reasons: [],
        assessedRevision: recorded?.assessedRevision ?? null,
        verifiedRevision: lastCommit(document.path),
        supersededParts: [],
      });
      continue;
    }
    const committed = lastCommit(document.path);
    if (!recordable.has(document.path)) unrecordable += 1;
    else if (recorded !== undefined && recorded.contentHash === document.contentHash)
      baselines.set(document.path, recorded.assessedRevision);
    else if (committed === null) withoutHistory += 1;
    else if (recorded !== undefined) {
      baselines.set(document.path, committed);
      fresh.add(document.path);
    } else reachable.push(document);
  }
  reachable.sort(
    (left, right) =>
      cadencePriority(left) - cadencePriority(right) || compare(left.path, right.path),
  );
  const swept = reachable.slice(0, Math.max(0, perDay - assessedBefore));
  for (const document of swept) {
    baselines.set(document.path, lastCommit(document.path)!);
    fresh.add(document.path);
  }
  const clock = input.budget?.clock ?? Date.now;
  const { found, unavailable, reused, unknownCommands, deferred } =
    await findDocumentLifecycleReasons({
      web,
      git,
      head,
      record,
      baselines,
      fresh,
      readDocument: input.readDocument,
      budget: {
        maximumGroups: input.budget?.maximumGroups ?? MAXIMUM_DOCUMENT_LIFECYCLE_GROUPS,
        deadline: input.budget?.deadline ?? clock() + DOCUMENT_LIFECYCLE_CALL_MILLISECONDS,
        clock,
      },
    });
  // A swept document whose group did not fit the budget was not assessed and keeps its place.
  const cadence = new Set(
    swept.map((document) => document.path).filter((path) => !deferred.has(path)),
  );
  const assessments = await matchingAssessments(input, head);

  const nextDocuments: DocumentLifecycleRecord["documents"] = {};
  const reached = new Map<string, DocumentLifecycleEvidence[]>();
  for (const document of documents) {
    const recorded = record.documents[document.path];
    if (entries.has(document.path)) {
      // Historical and retired documents keep their assessment for a later return to current.
      if (recorded !== undefined) nextDocuments[document.path] = recorded;
      continue;
    }
    const baseline = baselines.get(document.path);
    const parts = supersededParts(web, document);
    if (baseline === undefined || deferred.has(document.path)) {
      // Waiting for the sweep or for a later call; a deferred recorded assessment stays as it was.
      if (recorded !== undefined && deferred.has(document.path))
        nextDocuments[document.path] = recorded;
      entries.set(document.path, {
        path: document.path,
        state: "suspect",
        reasons: [cadenceReason(document.path)],
        assessedRevision: deferred.has(document.path) ? (recorded?.assessedRevision ?? null) : null,
        verifiedRevision: lastCommit(document.path),
        supersededParts: parts,
      });
      continue;
    }
    const assessment = assessments.get(document.path);
    const reasons = found.get(document.path) ?? [];
    const open = [
      ...reasons.filter(
        (reason) =>
          reason.resolution !== "deterministic" &&
          !(reason.resolution === "provider" && assessment !== undefined),
      ),
      ...missingReverseHeaders(web, document),
    ];
    if (reasons.length > 0 && !reused.has(document.path)) reached.set(document.path, open);
    const failed = unavailable.has(document.path);
    const providerReasons = reasons.filter((reason) => reason.resolution === "provider");
    const providerOpen = open.some((reason) => reason.resolution === "provider");
    const assessedRevision = failed || providerOpen ? baseline : head;
    // An unavailable baseline is dropped, so the cadence sweeps the document again from its commit.
    if (!failed)
      nextDocuments[document.path] = {
        contentHash: document.contentHash,
        assessedRevision,
        evaluatedAt: now.toISOString(),
        ...(assessedRevision === head
          ? {}
          : { reasons: providerReasons.slice(0, MAXIMUM_RECORDED_REASONS) }),
      };
    entries.set(document.path, {
      path: document.path,
      state:
        failed || open.length > 0
          ? "suspect"
          : assessment !== undefined
            ? "refreshed"
            : parts.length > 0
              ? "partially_superseded"
              : "current",
      reasons: open,
      assessedRevision,
      verifiedRevision: assessment?.assessedRevision ?? lastCommit(document.path),
      supersededParts: parts,
    });
  }
  // A restricted evaluation keeps the assessments of the documents it did not look at.
  for (const [path, recorded] of Object.entries(record.documents))
    if (nextDocuments[path] === undefined && recordable.has(path) && !entries.has(path))
      nextDocuments[path] = recorded;
  const assessedToday = assessedBefore + cadence.size;
  return {
    ...summarizeDocumentLifecycle({
      entries,
      unavailable,
      reached,
      cadence: {
        periodDays: DOCUMENT_LIFECYCLE_CADENCE_DAYS,
        perDay,
        assessedToday,
        unassessed: reachable.length - cadence.size + withoutHistory + unrecordable,
        reachable: reachable.length - cadence.size,
      },
    }),
    head,
    deferred,
    baselines,
    record: {
      schemaVersion: 1,
      kind: "document_lifecycle.record",
      revision: head,
      documents: Object.fromEntries(
        Object.entries(nextDocuments).filter(([path]) => recordable.has(path)),
      ),
      unknownCommands,
      cadence: { day, assessed: assessedToday },
      fence: null,
      summary: null,
    },
  };
}
