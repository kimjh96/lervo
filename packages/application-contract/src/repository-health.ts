/** Read-only Know/Find projection. Unknown is never an observed zero. */
export interface RepositoryHealthMeasureV1<T> {
  value: T | null;
  observedAt: string | null;
  source: string[];
  coverage: "complete" | "partial" | "unknown";
  status: "within_target" | "gap" | "unknown";
  reason: string | null;
  validUntil: string | null;
}

export interface RepositoryHealthAttentionV1 {
  itemId: string;
  kind: string;
  actor: string;
  requiresUserAction: boolean;
  consequence: string | null;
  recommendation: string;
  inspectCommand: string;
  waitingSince: string | null;
  ageMilliseconds: number | null;
}

export interface RepositoryHealthProjectionV1 {
  schemaVersion: 1;
  kind: "repository_health.projection";
  observedAt: string;
  repositoryRevision: string;
  measures: {
    convergence: RepositoryHealthMeasureV1<{
      state: string;
      reason: string | null;
      since: string | null;
      owner: string;
      recovery: string;
      residentState: string | null;
    }>;
    longestStop: RepositoryHealthMeasureV1<{
      since: string | null;
      ageMilliseconds: number | null;
      reportedAt: string | null;
      unreportedMilliseconds: number | null;
    }>;
    freshness: RepositoryHealthMeasureV1<{
      stale: number | null;
      evaluated: number | null;
      unevaluated: number | null;
      unknown: number | null;
      evaluationObservedAt: string | null;
      evaluationValidUntil: string | null;
      cycleObservedAt: string | null;
      cycleValidUntil: string | null;
      cycleStale: number | null;
      safety: number | null;
      firstSafetyPath: string | null;
      awaitingReview: number | null;
      refreshed: number | null;
      blocked: boolean | null;
    }>;
    ownerReview: RepositoryHealthMeasureV1<{
      count: number | null;
      confirmedCount: number;
      workstreamCount: number;
      items: RepositoryHealthAttentionV1[];
      omitted: number;
      upkeepCount: number | null;
    }>;
    deferred: RepositoryHealthMeasureV1<{
      count: number;
      items: Array<{ path: string; since: string | null; ageMilliseconds: number | null }>;
      omitted: number;
    }>;
    brokenLinks: RepositoryHealthMeasureV1<{ count: number }>;
    find: RepositoryHealthMeasureV1<{
      windowStart: string;
      lastInjectedAt: string | null;
      referencedCount: number;
      terminalPreparedCount: number;
      /** ADR-0550 terminal turn evidence; absent on projections written before it. */
      turnCount?: number;
      selectedTurnCount?: number;
      pathMentionCount?: number;
      /** ADR-0550 last replay over past changes, or null when none is recorded. */
      replay?: {
        observedAt: string;
        caseCount: number;
        recall: number | null;
        precision: number | null;
      } | null;
    }>;
  };
}
