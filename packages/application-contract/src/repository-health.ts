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

/** One source of Lervo debt with its count, oldest age, and most frequent reason. */
export interface RepositoryHealthLervoDebtSourceV1 {
  source: string;
  count: number;
  oldestSince: string | null;
  reason: string;
}

/** ADR-0562 document lifecycle counts; `suspect` splits by what settles each suspect. */
export interface RepositoryHealthDocumentLifecycleV1 {
  current: number;
  refreshed: number;
  partiallySuperseded: number;
  superseded: number;
  archived: number;
  retired: number;
  suspect: { provider: number; mechanical: number; cadence: number; unknown: number };
  cadence: { perDay: number; periodDays: number; unassessed: number; remainingDays: number };
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
      /** Candidates Lervo holds; the name predates ADR-0561, and none waits for the owner. */
      awaitingReview: number | null;
      refreshed: number | null;
      blocked: boolean | null;
      /**
       * Additive (ADR-0562): document lifecycle counts from the current-HEAD evaluation, absent
       * from older projections and null when the evaluation is missing, stale, or not lifecycle.
       */
      lifecycle?: RepositoryHealthDocumentLifecycleV1 | null;
      /** Additive (ADR-0561): stale documents Lervo holds as its own debt, oldest first. */
      debt?: Array<{
        path: string;
        reason: string;
        since: string;
        ageMilliseconds: number | null;
      }> | null;
    }>;
    /**
     * ADR-0561: every change Lervo holds as its own debt, across attention sources, parked
     * knowledge sources, and Node supervision and workstream replication. None waits for the
     * owner. Credentials Lervo cannot create are reported as notices beside it.
     */
    lervoDebt: RepositoryHealthMeasureV1<{
      count: number;
      oldestSince: string | null;
      oldestAgeMilliseconds: number | null;
      /** The most frequent reason code, ties broken by the oldest. */
      topReason: string | null;
      sources: RepositoryHealthLervoDebtSourceV1[];
      /** Missing credentials Lervo reports and works around; never an approval. */
      credentials: RepositoryHealthAttentionV1[];
    }>;
    deferred: RepositoryHealthMeasureV1<{
      count: number;
      items: Array<{ path: string; since: string | null; ageMilliseconds: number | null }>;
      omitted: number;
    }>;
    brokenLinks: RepositoryHealthMeasureV1<{
      count: number;
      /** ADR-0551 link web; absent on projections written before it. */
      missingBacklinkCount?: number;
      orphanCount?: number;
    }>;
    find: RepositoryHealthMeasureV1<{
      windowStart: string;
      lastInjectedAt: string | null;
      referencedCount: number;
      terminalPreparedCount: number;
      /** ADR-0550 terminal turn evidence; absent on projections written before it. */
      turnCount?: number;
      selectedTurnCount?: number;
      pathMentionCount?: number;
      /** ADR-0552 seven-day turns whose changes canon governs, and those that missed it. */
      governedTurnCount?: number;
      missedTurnCount?: number;
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
