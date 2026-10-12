import type {
  OperatingActionPlanV1,
  OperatingAdmissionSnapshotV1,
  OperatingMandate,
  OperatingPolicyReviewV1,
  OutcomeSupervisionReportV1,
  OutcomeSupervisionSnapshotV1,
  SupervisionResourceBudgetV1,
  WorkerReadinessObservationV1,
  WorkResponsibilityV1,
  SupervisionDecisionReceipt,
  OwnerControlReadinessV1,
  SupervisionPreflightInspectionV1,
} from "@lervo/application-contract";

export type { SupervisionDecisionReceipt } from "@lervo/application-contract";

/** An observed worker readiness failure before any effect invocation for a recorded decision. */
export interface SupervisionReadinessFailure {
  responsibility: WorkResponsibilityV1;
  observation: WorkerReadinessObservationV1;
  reasonCodes: string[];
}

/** Only a preflight that has not invoked the effect may report this failure. */
export class SupervisionPreflightError extends Error {
  readonly code = "supervision_preflight_failed";
  /** The failure code plus the bounded identifier code of its cause, when the cause carries one. */
  readonly reasonCodes: string[];
  readonly inspection: SupervisionPreflightInspectionV1 | null;

  constructor(options?: ErrorOptions & { inspection?: SupervisionPreflightInspectionV1 }) {
    super("Supervision preflight failed before effect invocation.", options);
    this.name = "SupervisionPreflightError";
    const cause = options?.cause as { code?: unknown } | undefined;
    const causeCode =
      typeof cause?.code === "string" &&
      /^[a-z][a-z0-9_]{0,63}$/u.test(cause.code) &&
      cause.code !== this.code
        ? cause.code
        : "preflight_cause_unclassified";
    this.reasonCodes = [this.code, causeCode];
    this.inspection =
      options?.inspection === undefined ? null : structuredClone(options.inspection);
  }
}

export interface OutcomeSupervisionPorts {
  now(): string;
  /** A live host restart may observe old bound work without treating startup as a new trigger. */
  deferInitialActionUntilChange?: boolean;
  /** Cross-process, fenced lease; expiration alone must not permit a second effect. */
  withOwnerLease<T>(supervisionId: string, operation: () => Promise<T>): Promise<T | null>;
  readSnapshot(supervisionId: string): Promise<OutcomeSupervisionSnapshotV1>;
  readMandate(mandateHash: string): Promise<OperatingMandate>;
  readAdmission(plan: OperatingActionPlanV1): Promise<OperatingAdmissionSnapshotV1>;
  readOwnerControlReadiness?(plan: OperatingActionPlanV1): Promise<OwnerControlReadinessV1>;
  readWorkerReadiness(plan: OperatingActionPlanV1): Promise<{
    responsibility: WorkResponsibilityV1;
    observation: WorkerReadinessObservationV1;
    requiredChecks: readonly WorkerReadinessObservationV1["checks"][number]["kind"][];
  }>;
  propose(report: OutcomeSupervisionReportV1): Promise<OperatingActionPlanV1 | null>;
  /** Fenced cleanup of canonically cancelled, unstarted work; never invokes providers or settles usage. */
  reconcileCancellation?(
    snapshot: OutcomeSupervisionSnapshotV1,
  ): Promise<{ eventIds: string[] } | null>;
  /** Includes unresolved old-source decisions; revision changes never erase uncertain effects. */
  findPendingPlan(supervisionId: string): Promise<OperatingActionPlanV1 | null>;
  /**
   * The event ID of the latest unresolved canonical preflight block, or null. A block survives
   * source-change supersession until its exact effect settles.
   */
  findUnresolvedPreflightBlock?(supervisionId: string): Promise<string | null>;
  /** Durable content-addressed decision record. Same identity with different bytes rejects. */
  recordDecision(
    plan: OperatingActionPlanV1,
    review: OperatingPolicyReviewV1,
  ): Promise<SupervisionDecisionReceipt>;
  findDecision(decisionId: string): Promise<SupervisionDecisionReceipt | null>;
  /** Reconcile known effects before replay. Unknown never means safe to retry. */
  inspectEffect(
    plan: OperatingActionPlanV1,
    receipt: SupervisionDecisionReceipt,
  ): Promise<{ status: "confirmed"; eventIds: string[] } | { status: "not_started" | "uncertain" }>;
  /** Instant after which a not-started effect can never begin, when earlier than plan.deadline. */
  readEffectStartDeadline?(plan: OperatingActionPlanV1): Promise<string | null>;
  /** Optional fenced adapter: verifies absence again and records canonical supersession atomically. */
  supersedeNotStarted?(plan: OperatingActionPlanV1, sourceRevisionDigest: string): Promise<boolean>;
  /** The effect adapter validates its exact payload against plan.effectHash and fences admission at commit. */
  execute(
    plan: OperatingActionPlanV1,
    review: OperatingPolicyReviewV1,
  ): Promise<{ eventIds: string[] }>;
  recordEffect(receipt: SupervisionDecisionReceipt): Promise<void>;
  /** Host diagnostics for an effect whose outcome became uncertain; never canonical evidence. */
  reportEffectFailure?(plan: OperatingActionPlanV1, error: unknown): void;
  /** Canonical safe non-start evidence for an observed (not merely unobserved) readiness failure. */
  recordReadinessFailure?(
    receipt: SupervisionDecisionReceipt,
    failure: SupervisionReadinessFailure,
  ): Promise<void>;
  /** Owner-fenced canonical evidence that the final effect preflight never invoked an effect. */
  recordPreflightBlocked?(
    receipt: SupervisionDecisionReceipt,
    plan: OperatingActionPlanV1,
    inspection: SupervisionPreflightInspectionV1,
  ): Promise<void>;
  recordAttention(
    report: OutcomeSupervisionReportV1,
    reasonCodes: string[],
    details?: { resourceBudget?: SupervisionResourceBudgetV1 },
  ): Promise<void>;
}
