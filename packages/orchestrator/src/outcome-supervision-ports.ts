import type {
  OperatingActionPlanV1,
  OperatingAdmissionSnapshotV1,
  OperatingMandate,
  OperatingPolicyReviewV1,
  OutcomeSupervisionReportV1,
  OutcomeSupervisionSnapshotV1,
  WorkerReadinessObservationV1,
  WorkResponsibilityV1,
  SupervisionDecisionReceipt,
  OwnerControlReadinessV1,
} from "@lervo/application-contract";

export type { SupervisionDecisionReceipt } from "@lervo/application-contract";

export interface OutcomeSupervisionPorts {
  now(): string;
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
  /** Optional fenced adapter: verifies absence again and records canonical supersession atomically. */
  supersedeNotStarted?(plan: OperatingActionPlanV1, sourceRevisionDigest: string): Promise<boolean>;
  /** The effect adapter validates its exact payload against plan.effectHash and fences admission at commit. */
  execute(
    plan: OperatingActionPlanV1,
    review: OperatingPolicyReviewV1,
  ): Promise<{ eventIds: string[] }>;
  recordEffect(receipt: SupervisionDecisionReceipt): Promise<void>;
  recordAttention(report: OutcomeSupervisionReportV1, reasonCodes: string[]): Promise<void>;
}
