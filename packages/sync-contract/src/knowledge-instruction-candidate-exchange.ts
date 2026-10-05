import { canonicalJson } from "@lervo/event-contract";
import { projectIdSchema } from "@lervo/schemas";

import { syncContentHash } from "./hash.js";

/**
 * ADR-0467 cross-host exchange of owner-rule candidates. The host that observed an owner turn
 * assesses it and publishes the typed candidate here; every host of the repository reads it, and
 * the convergence owner reviews and applies it. A record never carries owner or agent turn text:
 * the candidate holds the normalized rule, its proposed Markdown, and digests only.
 *
 * Records are keyed by the proposed Markdown hash, so the same rule captured on two hosts is one
 * record. A resolution (`applied` or `rejected`) is final and wins over any later open publish.
 */
const HASH = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_ID = new RegExp(projectIdSchema.pattern, "u");
export const MAXIMUM_INSTRUCTION_CANDIDATE_RECORD_BYTES = 16 * 1024;
export const MAXIMUM_INSTRUCTION_CANDIDATE_RECORDS = 64;

export type KnowledgeInstructionCandidateResolution = "open" | "applied" | "rejected";

export interface KnowledgeInstructionCandidateRecord {
  schemaVersion: 1;
  projectId: string;
  repositoryIdentityHash: string;
  /** Hash of the proposed Markdown; the cross-host identity of one rule. */
  proposedContentHash: string;
  /** `sha256` of the canonical candidate JSON, so a reader can verify the bytes it imports. */
  candidateHash: string;
  /** The typed durable-instruction candidate; validated again by every importing host. */
  candidate: Record<string, unknown>;
  sourceHostHash: string;
  resolution: KnowledgeInstructionCandidateResolution;
  resolvedByHostHash: string | null;
  publishedAt: string;
  resolvedAt: string | null;
}

export type KnowledgeInstructionCandidatePublishStatus = "created" | "updated" | "duplicate";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function knowledgeInstructionCandidateHash(candidate: unknown): string {
  return syncContentHash(candidate);
}

const KEYS = [
  "schemaVersion",
  "projectId",
  "repositoryIdentityHash",
  "proposedContentHash",
  "candidateHash",
  "candidate",
  "sourceHostHash",
  "resolution",
  "resolvedByHostHash",
  "publishedAt",
  "resolvedAt",
];

/** Structural validation; the candidate's own contract is checked by the importing host. */
export function isKnowledgeInstructionCandidateRecord(
  value: unknown,
): value is KnowledgeInstructionCandidateRecord {
  if (!record(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== KEYS.length || keys.some((key) => !KEYS.includes(key))) return false;
  const candidate = value.candidate;
  return (
    value.schemaVersion === 1 &&
    typeof value.projectId === "string" &&
    PROJECT_ID.test(value.projectId) &&
    typeof value.repositoryIdentityHash === "string" &&
    HASH.test(value.repositoryIdentityHash) &&
    typeof value.proposedContentHash === "string" &&
    HASH.test(value.proposedContentHash) &&
    typeof value.candidateHash === "string" &&
    record(candidate) &&
    candidate.projectId === value.projectId &&
    candidate.proposedContentHash === value.proposedContentHash &&
    Buffer.byteLength(canonicalJson(candidate)) <= MAXIMUM_INSTRUCTION_CANDIDATE_RECORD_BYTES &&
    knowledgeInstructionCandidateHash(candidate) === value.candidateHash &&
    typeof value.sourceHostHash === "string" &&
    HASH.test(value.sourceHostHash) &&
    (value.resolution === "open" ||
      value.resolution === "applied" ||
      value.resolution === "rejected") &&
    (value.resolution === "open"
      ? value.resolvedByHostHash === null && value.resolvedAt === null
      : typeof value.resolvedByHostHash === "string" &&
        HASH.test(value.resolvedByHostHash) &&
        timestamp(value.resolvedAt)) &&
    timestamp(value.publishedAt)
  );
}

/**
 * The Hub's pure merge for one publish. The first record for a rule is kept as published; a
 * resolution replaces an open record once; an open publish never reopens a resolved rule.
 */
export function mergeKnowledgeInstructionCandidateRecord(input: {
  current: KnowledgeInstructionCandidateRecord | null;
  incoming: KnowledgeInstructionCandidateRecord;
}): {
  next: KnowledgeInstructionCandidateRecord;
  status: KnowledgeInstructionCandidatePublishStatus;
} {
  const { current, incoming } = input;
  if (current === null) return { next: incoming, status: "created" };
  if (current.resolution !== "open" || incoming.resolution === "open")
    return { next: current, status: "duplicate" };
  return {
    next: {
      ...current,
      resolution: incoming.resolution,
      resolvedByHostHash: incoming.resolvedByHostHash,
      resolvedAt: incoming.resolvedAt,
    },
    status: "updated",
  };
}
