import type { WorkstreamSnapshot } from "@lervo/schemas";

export interface WorkstreamFreshnessPolicy {
  /** A snapshot whose recorded HEAD is more than this many commits behind HEAD is stale. */
  staleAfterCommits: number;
  /** A snapshot whose updatedAt is older than this many hours is stale. */
  staleAfterHours: number;
}

export const defaultWorkstreamFreshnessPolicy: WorkstreamFreshnessPolicy = {
  staleAfterCommits: 20,
  staleAfterHours: 48,
};

/** Clock skew tolerated before a future updatedAt is treated as untrustworthy. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * How far the current repository HEAD is from the snapshot's recorded HEAD. `unresolvable` means
 * the recorded commit is not in this repository's history or Git could not answer.
 */
export type WorkstreamHeadDistance =
  | { status: "measured"; commitsBehind: number }
  | { status: "unresolvable" }
  | { status: "not_recorded" };

export type WorkstreamStaleReason =
  "commits_behind" | "recorded_head_unresolvable" | "age_exceeded" | "updated_at_in_future";

export interface WorkstreamFreshness {
  status: "current" | "stale";
  reasons: WorkstreamStaleReason[];
  commitsBehind: number | null;
  ageHours: number;
  policy: WorkstreamFreshnessPolicy;
}

/**
 * Pure staleness decision. Snapshots that predate HEAD recording rely on the age rule alone, so
 * an old caller-supplied `updatedAt` still makes them stale.
 */
export function assessWorkstreamFreshness(input: {
  snapshot: Pick<WorkstreamSnapshot, "updatedAt">;
  headDistance: WorkstreamHeadDistance;
  observedAt: Date;
  policy?: WorkstreamFreshnessPolicy;
}): WorkstreamFreshness {
  const policy = input.policy ?? defaultWorkstreamFreshnessPolicy;
  const ageMs = input.observedAt.getTime() - Date.parse(input.snapshot.updatedAt);
  const reasons: WorkstreamStaleReason[] = [];
  if (!Number.isFinite(ageMs) || ageMs < -FUTURE_TOLERANCE_MS) reasons.push("updated_at_in_future");
  else if (ageMs > policy.staleAfterHours * 3_600_000) reasons.push("age_exceeded");
  if (input.headDistance.status === "unresolvable") reasons.push("recorded_head_unresolvable");
  if (
    input.headDistance.status === "measured" &&
    input.headDistance.commitsBehind > policy.staleAfterCommits
  )
    reasons.push("commits_behind");
  return {
    status: reasons.length === 0 ? "current" : "stale",
    reasons,
    commitsBehind:
      input.headDistance.status === "measured" ? input.headDistance.commitsBehind : null,
    ageHours: Number.isFinite(ageMs) ? Math.max(0, Math.floor(ageMs / 3_600_000)) : 0,
    policy,
  };
}

/**
 * Consequence classes follow the consequential effects in the repository invariants: repository
 * writes, deployment, and external effects. A decision carries no structured consequence class,
 * so it is `unclassified`; free text is never classified. Every class, including unclassified, is
 * consequential, so a stale approval or decision is never rendered as a directive or with its text.
 */
export type WorkstreamItemConsequence =
  "repository_write" | "deployment" | "external_effect" | "unclassified";

const APPROVAL_CONSEQUENCES: Record<
  NonNullable<WorkstreamSnapshot["pendingApprovals"]>[number]["kind"],
  WorkstreamItemConsequence
> = {
  repository_bytes: "repository_write",
  managed_write: "repository_write",
  external_action: "external_effect",
  deployment: "deployment",
};

export function workstreamApprovalConsequence(
  kind: NonNullable<WorkstreamSnapshot["pendingApprovals"]>[number]["kind"],
): WorkstreamItemConsequence {
  return APPROVAL_CONSEQUENCES[kind] ?? "unclassified";
}

export const STALE_WORKSTREAM_INSTRUCTION =
  "Re-verify against the repository before acting; do not present as current.";
