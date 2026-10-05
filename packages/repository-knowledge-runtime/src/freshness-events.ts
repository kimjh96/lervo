import {
  canonicalJson,
  sha256,
  type DocumentFreshnessCandidateV1,
} from "@lervo/repository-knowledge";
import type { ProjectStorage } from "@lervo/project-storage";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Freshness events exist only in event schema 4; an older writer cannot record an apply. */
export const FRESHNESS_EVENT_SCHEMA_VERSION = 4;
const POLICY_VERSION = sha256("lervo.document-freshness.v1");

function hex(value: string, length: number): string {
  return sha256(value).slice("sha256:".length, "sha256:".length + length);
}

export function assertFreshnessEventsWritable(
  storage: Pick<ProjectStorage, "writableEventSchemaVersion">,
): void {
  if ((storage.writableEventSchemaVersion ?? 1) < FRESHNESS_EVENT_SCHEMA_VERSION)
    throw new KnowledgeConvergenceRuntimeError("freshness_event_writer_unavailable");
}

/**
 * Appends one freshness lifecycle event. The event identity binds the type and the caller's
 * coordinate, so a retried step after a crash reuses the stored event instead of duplicating it.
 */
export function appendFreshnessEvent(input: {
  storage: Pick<ProjectStorage, "events" | "manifest">;
  type:
    | "document.freshness.candidate.created"
    | "document.freshness.candidate.verified"
    | "document.freshness.candidate.applied"
    | "document.freshness.candidate.rejected"
    | "document.freshness.candidate.reverted"
    | "document.freshness.cycle.completed";
  correlationId: string;
  coordinate: unknown;
  payload: Record<string, unknown>;
  occurredAt: string;
}): void {
  const identity = hex(
    `${input.type}\0${input.correlationId}\0${canonicalJson(input.coordinate)}`,
    32,
  );
  const scope = hex(`lervo.document-freshness\0${input.correlationId}`, 24);
  input.storage.events.append({
    eventId: `evt_${identity}`,
    projectId: input.storage.manifest.projectId,
    runId: `run_freshness_${scope}`,
    sessionId: `ses_freshness_${scope}`,
    occurredAt: input.occurredAt,
    actor: { kind: "system" },
    schemaVersion: FRESHNESS_EVENT_SCHEMA_VERSION,
    policyVersion: POLICY_VERSION,
    type: input.type,
    payload: input.payload,
  });
}

export function changeClassesOf(candidate: Pick<DocumentFreshnessCandidateV1, "hunks">): string[] {
  return [...new Set(candidate.hunks.map((hunk) => hunk.changeClass))].sort();
}

/** `created`, then `verified` or `rejected`, for one newly built candidate. */
export function recordFreshnessCandidateOutcome(input: {
  storage: Pick<ProjectStorage, "events" | "manifest">;
  candidate: DocumentFreshnessCandidateV1;
  documentHash: string;
  occurredAt: string;
}): void {
  const { candidate } = input;
  appendFreshnessEvent({
    storage: input.storage,
    type: "document.freshness.candidate.created",
    correlationId: candidate.candidateId,
    coordinate: null,
    occurredAt: input.occurredAt,
    payload: {
      candidateId: candidate.candidateId,
      findingDigest: candidate.findingDigest,
      documentPath: candidate.documentPath,
      documentHash: input.documentHash,
      operation: candidate.operation,
      priorityClass: candidate.priorityClass,
      changeClasses: changeClassesOf(candidate),
      hunkCount: candidate.hunks.length,
      evidenceCount: candidate.evidenceCount,
      evidenceTruncated: candidate.evidenceTruncated,
      usageObserved: candidate.tokensObserved,
      occurredAt: input.occurredAt,
    },
  });
  if (candidate.state === "rejected") {
    recordFreshnessRejection({ storage: input.storage, candidate, occurredAt: input.occurredAt });
    return;
  }
  appendFreshnessEvent({
    storage: input.storage,
    type: "document.freshness.candidate.verified",
    correlationId: candidate.candidateId,
    coordinate: null,
    occurredAt: input.occurredAt,
    payload: {
      candidateId: candidate.candidateId,
      checks: candidate.checks.map((check) => ({ code: check.code, status: check.status })),
      crossCheck: candidate.crossCheck,
      deliberationRunId: null,
      authorityRequired: candidate.authorityRequired,
      afterHash: candidate.afterHash,
      occurredAt: input.occurredAt,
    },
  });
}

export function recordFreshnessRejection(input: {
  storage: Pick<ProjectStorage, "events" | "manifest">;
  candidate: DocumentFreshnessCandidateV1;
  occurredAt: string;
}): void {
  const rejection = input.candidate.rejection;
  if (rejection === null) throw new KnowledgeConvergenceRuntimeError("freshness_rejection_missing");
  appendFreshnessEvent({
    storage: input.storage,
    type: "document.freshness.candidate.rejected",
    correlationId: input.candidate.candidateId,
    coordinate: [rejection.reasonCode, rejection.rejectorKind],
    occurredAt: input.occurredAt,
    payload: {
      candidateId: input.candidate.candidateId,
      reasonCode: rejection.reasonCode,
      rejectorKind: rejection.rejectorKind,
      contestedHunkIds: rejection.contestedHunkIds,
      occurredAt: input.occurredAt,
    },
  });
}
