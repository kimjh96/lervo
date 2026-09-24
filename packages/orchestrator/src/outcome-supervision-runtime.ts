import type {
  OutcomeSupervisionReportV1,
  OutcomeSupervisionSnapshotV1,
} from "@lervo/application-contract";
import {
  operatingContractHash,
  operatingDecisionId,
  projectOutcomeSupervision,
  reviewOperatingAction,
  evaluateWorkerReadiness,
  operatingReadinessKind,
  assertOwnerControlReadiness,
} from "@lervo/work-controller";

import type {
  OutcomeSupervisionPorts,
  SupervisionDecisionReceipt,
} from "./outcome-supervision-ports.js";
import { SupervisionPreflightError } from "./outcome-supervision-ports.js";

export interface OutcomeSupervisionCycleResult {
  disposition: "idle" | "busy" | "blocked" | "changed" | "effect_confirmed" | "uncertain";
  report: OutcomeSupervisionReportV1 | null;
}

function assertReceipt(
  receipt: SupervisionDecisionReceipt,
  decisionId: string,
  planHash: string,
): void {
  if (
    receipt.decisionId !== decisionId ||
    receipt.planHash !== planHash ||
    !["recorded", "effect_confirmed", "uncertain", "superseded"].includes(receipt.status) ||
    !Array.isArray(receipt.effectEventIds) ||
    receipt.effectEventIds.length > 64 ||
    receipt.effectEventIds.some((id) => !/^evt_[a-f0-9]{32}$/u.test(id)) ||
    (receipt.status === "effect_confirmed" && receipt.effectEventIds.length === 0)
  ) {
    throw new Error("The supervision decision receipt conflicts with the exact plan.");
  }
}

/** The effect adapter's bounded identifier code, if it carries one; never its message. */
function boundedErrorCode(error: unknown): string[] {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code) ? [code] : [];
}

/** A leased or dispatched assignment is an unfinished duty, not a new request trigger. */
function hasDurableWorkerContinuation(snapshot: OutcomeSupervisionSnapshotV1): boolean {
  return snapshot.assignments.some(
    (assignment) =>
      assignment.terminalEventId === null &&
      (assignment.status === "leased" || assignment.dispatchedAt !== null),
  );
}

/** Composes canonical sources and effects; contains no provider or chat routing. */
export class OutcomeSupervisionRuntime {
  private readonly cursors = new Map<string, { digest: string; nextCheckAt: string | null }>();

  constructor(private readonly ports: OutcomeSupervisionPorts) {}

  async runCycle(supervisionId: string): Promise<OutcomeSupervisionCycleResult> {
    const result = await this.ports.withOwnerLease(supervisionId, async () => {
      const snapshot = await this.ports.readSnapshot(supervisionId);
      if (snapshot.supervisionId !== supervisionId)
        throw new Error("The supervision owner binding changed.");
      const now = this.ports.now();
      const previous = this.cursors.get(supervisionId);
      const pending = await this.ports.findPendingPlan(supervisionId);
      if (
        previous === undefined &&
        this.ports.deferInitialActionUntilChange === true &&
        pending === null &&
        snapshot.evidenceStatus === "valid" &&
        snapshot.authorityStatus === "active" &&
        snapshot.workstreamStatus === "active" &&
        !hasDurableWorkerContinuation(snapshot)
      ) {
        this.cursors.set(supervisionId, {
          digest: snapshot.sourceRevisionDigest,
          nextCheckAt: null,
        });
        return { disposition: "idle" as const, report: null };
      }
      if (
        snapshot.evidenceStatus === "valid" &&
        snapshot.authorityStatus === "active" &&
        previous?.digest === snapshot.sourceRevisionDigest &&
        (previous.nextCheckAt === null || Date.parse(previous.nextCheckAt) > Date.parse(now))
      ) {
        return { disposition: "idle" as const, report: null };
      }
      const mandate = await this.ports.readMandate(snapshot.mandateHash);
      if (operatingContractHash(mandate) !== snapshot.mandateHash)
        throw new Error("The supervision mandate artifact is corrupt.");
      const replaySnapshot = pending === null ? snapshot : { ...snapshot, pendingDecision: false };
      const report = projectOutcomeSupervision({
        snapshot:
          Date.parse(now) >= Date.parse(mandate.expiresAt)
            ? { ...replaySnapshot, authorityStatus: "expired" }
            : replaySnapshot,
        now,
        maximumRecoveryDecisions: Math.min(3, mandate.maximumAttemptsPerAssignment - 1),
      });
      const pendingDeadlineElapsed =
        pending !== null && Date.parse(now) >= Date.parse(pending.deadline);
      if (
        pending !== null &&
        (pending.sourceRevisionDigest !== snapshot.sourceRevisionDigest ||
          pending.mandateHash !== snapshot.mandateHash ||
          pending.ownerAgentId !== snapshot.ownerAgentId ||
          pendingDeadlineElapsed ||
          report.status === "invalid" ||
          report.nextAction === null)
      ) {
        if (
          pending.supervisionId !== supervisionId ||
          pending.projectId !== snapshot.projectId ||
          pending.workstreamId !== snapshot.workstreamId
        )
          throw new Error("The recovered supervision plan belongs to another goal.");
        const decisionId = operatingDecisionId(pending);
        const receipt = await this.ports.findDecision(decisionId);
        if (receipt === null)
          throw new Error("The recovered supervision plan has no decision evidence.");
        assertReceipt(receipt, decisionId, operatingContractHash(pending));
        const observed = await this.ports.inspectEffect(pending, receipt);
        if (observed.status === "confirmed") {
          const confirmed = {
            ...receipt,
            status: "effect_confirmed" as const,
            effectEventIds: observed.eventIds,
          };
          assertReceipt(confirmed, decisionId, operatingContractHash(pending));
          await this.ports.recordEffect(confirmed);
          return { disposition: "effect_confirmed" as const, report };
        }
        if (
          observed.status === "not_started" &&
          (pending.sourceRevisionDigest !== snapshot.sourceRevisionDigest ||
            pendingDeadlineElapsed) &&
          (await this.ports.supersedeNotStarted?.(pending, snapshot.sourceRevisionDigest)) === true
        ) {
          const superseded = await this.ports.findDecision(decisionId);
          if (superseded === null) throw new Error("The superseded decision is unavailable.");
          assertReceipt(superseded, decisionId, operatingContractHash(pending));
          if (superseded.status !== "superseded")
            throw new Error("Supersession requires canonical decision evidence.");
          return { disposition: "changed" as const, report };
        }
        await this.ports.recordAttention(report, ["pending_decision_requires_reconciliation"]);
        return { disposition: "uncertain" as const, report };
      }
      if (report.status === "invalid") {
        await this.ports.recordAttention(report, [report.reasonCode]);
        return { disposition: "blocked" as const, report };
      }
      if (report.nextAction === null) {
        this.remember(supervisionId, report, mandate.expiresAt);
        return { disposition: "idle" as const, report };
      }
      if (report.nextAction === "reconcile_cancellation" && pending === null) {
        const reconciled = await this.ports.reconcileCancellation?.(snapshot);
        if (reconciled !== null && reconciled !== undefined) {
          if (
            reconciled.eventIds.length === 0 ||
            reconciled.eventIds.length > 64 ||
            !reconciled.eventIds.every((id) => /^evt_[a-f0-9]{32}$/u.test(id))
          )
            throw new Error("Cancellation reconciliation requires canonical event evidence.");
          return { disposition: "changed" as const, report };
        }
        await this.ports.recordAttention(report, ["cancellation_requires_effect_reconciliation"]);
        this.remember(supervisionId, report, mandate.expiresAt);
        return { disposition: "blocked" as const, report };
      }
      if (
        pending === null &&
        (await this.ports.hasUnresolvedPreflightBlock?.(supervisionId)) === true
      ) {
        await this.ports.recordAttention(report, ["preflight_repair_requires_review"]);
        return { disposition: "blocked" as const, report };
      }
      const plan = pending ?? (await this.ports.propose(report));
      if (plan === null) {
        await this.ports.recordAttention(report, ["owner_plan_unavailable"]);
        this.remember(supervisionId, report, mandate.expiresAt);
        return { disposition: "blocked" as const, report };
      }
      if (
        plan.supervisionId !== supervisionId ||
        plan.ownerAgentId !== snapshot.ownerAgentId ||
        plan.projectId !== snapshot.projectId ||
        plan.workstreamId !== snapshot.workstreamId ||
        plan.sourceRevisionDigest !== snapshot.sourceRevisionDigest ||
        plan.mandateHash !== snapshot.mandateHash ||
        plan.causationEventIds.length !== snapshot.causationEventIds.length ||
        !plan.causationEventIds.every((id) => snapshot.causationEventIds.includes(id))
      ) {
        throw new Error("The owner proposal differs from its causal source binding.");
      }
      const allowedActions =
        report.reasonCode === "workforce_plan_required"
          ? ["allocate_existing", "execute_as_owner", "hire_worker", "request_team_support"]
          : report.nextAction === "review_artifacts" || report.nextAction === "complete_workstream"
            ? ["execute_as_owner"]
            : report.nextAction === "reconcile_cancellation"
              ? ["inspect_uncertain_effect"]
              : [report.nextAction];
      const ownerReasoning =
        plan.actionKind === "execute_as_owner" &&
        plan.effectContract === "work.owner_reasoning.v1" &&
        report.nextAction !== "reconcile_cancellation";
      const workspacePreparation =
        report.nextAction === "dispatch" &&
        plan.actionKind === "execute_as_owner" &&
        plan.effectContract === "work.workspace_preparation.v1";
      const successorClaim =
        ["allocate_existing", "dispatch", "inspect_uncertain_effect"].includes(report.nextAction) &&
        plan.actionKind === "revise_responsibility" &&
        ["work.responsibility_claim.v1", "work.assignment_amendment.v1"].includes(
          plan.effectContract,
        );
      const scopedHandoff =
        report.nextAction !== "reconcile_cancellation" &&
        ((["request_team_support", "escalate"].includes(plan.actionKind) &&
          plan.effectContract === "work.scoped_handoff.v1") ||
          (plan.actionKind === "execute_as_owner" &&
            plan.effectContract === "work.scoped_handoff_acceptance.v1"));
      const ownerAttention =
        report.nextAction !== "reconcile_cancellation" &&
        plan.actionKind === "escalate" &&
        plan.effectContract === "work.owner_attention.v1";
      const blockedArtifactReview =
        report.reasonCode === "acceptance_blocked" &&
        report.nextAction === "escalate" &&
        plan.actionKind === "execute_as_owner" &&
        plan.effectContract === "work.artifact_review.v1";
      if (
        !ownerReasoning &&
        !workspacePreparation &&
        !successorClaim &&
        !scopedHandoff &&
        !ownerAttention &&
        !blockedArtifactReview &&
        !allowedActions.includes(plan.actionKind)
      ) {
        await this.ports.recordAttention(report, ["effect_mapping_unavailable"]);
        return { disposition: "blocked" as const, report };
      }
      const admission = await this.ports.readAdmission(plan);
      this.assertFreshObservation(admission.observedAt);
      const review = reviewOperatingAction({ mandate, plan, snapshot: admission });
      if (review.disposition !== "admitted") {
        await this.ports.recordAttention(report, review.reasonCodes);
        this.remember(supervisionId, report, mandate.expiresAt);
        return { disposition: "blocked" as const, report };
      }
      const existing = await this.ports.findDecision(review.decisionId);
      if (existing !== null) {
        assertReceipt(existing, review.decisionId, review.planHash);
        const observed = await this.ports.inspectEffect(plan, existing);
        if (observed.status === "confirmed") {
          const receipt = {
            ...existing,
            status: "effect_confirmed" as const,
            effectEventIds: observed.eventIds,
          };
          assertReceipt(receipt, review.decisionId, review.planHash);
          await this.ports.recordEffect(receipt);
          this.remember(supervisionId, report, mandate.expiresAt);
          return { disposition: "effect_confirmed" as const, report };
        }
        if (observed.status === "uncertain" || existing.status !== "recorded") {
          await this.ports.recordAttention(report, ["effect_outcome_uncertain"]);
          return { disposition: "uncertain" as const, report };
        }
      }
      const recorded = existing ?? (await this.ports.recordDecision(plan, review));
      assertReceipt(recorded, review.decisionId, review.planHash);
      if (recorded.status !== "recorded") {
        await this.ports.recordAttention(report, ["effect_outcome_uncertain"]);
        return { disposition: "uncertain" as const, report };
      }
      const current = await this.ports.readAdmission(plan);
      this.assertFreshObservation(current.observedAt);
      const freshReview = reviewOperatingAction({ mandate, plan, snapshot: current });
      if (
        freshReview.disposition !== "admitted" ||
        current.sourceRevisionDigest !== admission.sourceRevisionDigest ||
        current.installedMandateHash !== admission.installedMandateHash
      ) {
        await this.ports.recordAttention(
          report,
          freshReview.reasonCodes.length > 0 ? freshReview.reasonCodes : ["source_changed"],
        );
        return { disposition: "changed" as const, report };
      }
      if (operatingReadinessKind(plan) === "owner_control") {
        if (this.ports.readOwnerControlReadiness === undefined) {
          await this.ports.recordAttention(report, ["owner_control_readiness_unavailable"]);
          return { disposition: "blocked" as const, report };
        }
        const observation = await this.ports.readOwnerControlReadiness(plan);
        assertOwnerControlReadiness({ plan, observation, now: this.ports.now() });
      }
      if (operatingReadinessKind(plan) === "worker") {
        const readiness = await this.ports.readWorkerReadiness(plan);
        if (operatingContractHash(readiness.responsibility) !== plan.responsibilityArtifactHash) {
          throw new Error("The dispatch responsibility differs from the reviewed plan.");
        }
        const preflight = evaluateWorkerReadiness({
          ...readiness,
          sourceRevisionDigest: current.sourceRevisionDigest,
          now: this.ports.now(),
        });
        if (preflight.status !== "ready") {
          if (
            preflight.reasonCodes.some((code) => /^readiness_[a-z_]+_failed$/u.test(code)) &&
            this.ports.recordReadinessFailure !== undefined
          )
            await this.ports.recordReadinessFailure(recorded, {
              responsibility: readiness.responsibility,
              observation: readiness.observation,
              reasonCodes: preflight.reasonCodes,
            });
          await this.ports.recordAttention(report, preflight.reasonCodes);
          return { disposition: "blocked" as const, report };
        }
      }
      try {
        const effect = await this.ports.execute(plan, freshReview);
        const receipt = {
          ...recorded,
          status: "effect_confirmed" as const,
          effectEventIds: effect.eventIds,
        };
        assertReceipt(receipt, review.decisionId, review.planHash);
        await this.ports.recordEffect(receipt);
        this.remember(supervisionId, report, mandate.expiresAt);
        return { disposition: "effect_confirmed" as const, report };
      } catch (error) {
        if (error instanceof SupervisionPreflightError) {
          if (error.inspection !== null)
            await this.ports.recordPreflightBlocked?.(recorded, plan, error.inspection);
          await this.ports.recordAttention(report, error.reasonCodes);
          return { disposition: "blocked" as const, report };
        }
        await this.ports.recordEffect({ ...recorded, status: "uncertain", effectEventIds: [] });
        await this.ports.recordAttention(report, [
          "effect_outcome_uncertain",
          ...boundedErrorCode(error),
        ]);
        return { disposition: "uncertain" as const, report };
      }
    });
    return result ?? { disposition: "busy", report: null };
  }

  private assertFreshObservation(observedAt: string): void {
    const age = Date.parse(this.ports.now()) - Date.parse(observedAt);
    if (!Number.isFinite(age) || age < 0 || age > 5_000) {
      throw new Error("The operating admission observation is stale.");
    }
  }

  private remember(
    supervisionId: string,
    report: OutcomeSupervisionReportV1,
    expiresAt: string,
  ): void {
    this.cursors.delete(supervisionId);
    this.cursors.set(supervisionId, {
      digest: report.sourceRevisionDigest,
      nextCheckAt:
        report.nextCheckAt !== null && Date.parse(report.nextCheckAt) < Date.parse(expiresAt)
          ? report.nextCheckAt
          : expiresAt,
    });
    while (this.cursors.size > 256) this.cursors.delete(this.cursors.keys().next().value!);
  }
}
