import type { PracticeReview, ReusablePractice } from "@lervo/repository-knowledge";

export interface PracticeStep {
  entryId: string;
  kind: string;
  executable: string | null;
  paths: string[];
  outcome: "passed" | "failed" | "unknown";
  verification: boolean;
}

export interface PracticeWorkRecord {
  workDigest: string;
  contextEventId: string;
  turnEventId: string;
  provider: "codex" | "claude";
  sessionDigest: string;
  turnDigest: string | null;
  observedAt: string;
  revisionBefore: string | null;
  revisionAfter: string | null;
  stopCommit: string | null;
  changedFiles: Array<{ path: string; before: string | null; after: string | null }>;
  reply: string;
  steps: PracticeStep[];
  outcome: "passed" | "verification_unavailable";
  complete: boolean;
}

export interface PracticeEvidence {
  work: PracticeWorkRecord;
  procedure: ReusablePractice;
  excerpts: Array<{ path: string; contentHash: string; text: string }>;
  evidenceHash: string;
  ownerResponse?: { digest: string; excerpt: string };
}

export type PracticeCandidateState =
  | "observed"
  | "assessed"
  | "unresolved"
  | "drafted"
  | "reviewed_accepted"
  | "reviewed_rejected"
  | "materialized"
  | "published"
  | "exposed"
  | "used"
  | "retired";

export interface PracticeCandidate {
  candidateId: string;
  practiceDigest: string;
  workDigests: string[];
  evidenceHashes: string[];
  observedAt: string;
  state: PracticeCandidateState;
  overlap: "new" | "partial_overlap" | "conflict";
  targetSkill: string | null;
  targetHash: string | null;
  targetOwned: boolean;
  catalogDigest: string;
  draft: string | null;
  draftHash: string | null;
  drafterAgentId: string | null;
  drafterSessionId: string | null;
  review: PracticeReview | null;
  reason: string | null;
  redrafts: number;
  commit: string | null;
}

export interface GeneratedPracticeSkill {
  name: string;
  path: string;
  versionHash: string;
  candidateId: string;
  commit: string;
  exposedAt: string | null;
  reevaluatedAt: string | null;
}

export interface PracticeState {
  schemaVersion: 1;
  works: PracticeWorkRecord[];
  evidence: PracticeEvidence[];
  candidates: PracticeCandidate[];
  generated: GeneratedPracticeSkill[];
  shapes: Array<{ workDigest: string; digest: string; steps: string[]; observedAt: string }>;
  assessed: Array<{ workDigest: string; at: string }>;
  funnel: Array<{ day: string; counts: Record<string, number>; drops: Record<string, number> }>;
}

/** Repetition informs ranking and review confidence, never candidate eligibility. */
export function practiceShapeSupport(state: PracticeState, workDigests: string[]): number {
  const shapes = new Set(
    state.shapes.filter((s) => workDigests.includes(s.workDigest)).map((s) => s.digest),
  );
  return state.shapes.filter((s) => shapes.has(s.digest)).length;
}

export function practiceFunnel(
  state: PracticeState,
  now: Date,
  stage: string,
  reason?: string,
): void {
  const day = now.toISOString().slice(0, 10);
  let row = state.funnel.find((entry) => entry.day === day);
  if (!row) {
    row = { day, counts: {}, drops: {} };
    state.funnel.push(row);
  }
  const counts = reason === undefined ? row.counts : row.drops;
  const key = reason === undefined ? stage : `${stage}:${reason}`;
  counts[key] = (counts[key] ?? 0) + 1;
}
