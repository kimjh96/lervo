import { SupervisionCycleCursors, supervisionCursorDigest } from "./outcome-supervision-cursors.js";
import type { OutcomeSupervisionReportV1 } from "@lervo/application-contract";
import {
  operatingContractHash,
  operatingDecisionId,
  projectOutcomeSupervision,
  principalEscalationBoundElapsed,
  reviewOperatingAction,
  evaluateWorkerReadiness,
  operatingReadinessKind,
  assertOwnerControlReadiness,
} from "@lervo/work-controller";

import type { OutcomeSupervisionPorts } from "./outcome-supervision-ports.js";
import { SupervisionPreflightError } from "./outcome-supervision-ports.js";
import { SupervisionReadinessHolds } from "./outcome-supervision-readiness-hold.js";
import { supervisionEffectMapped } from "./outcome-supervision-effect-mapping.js";
import {
  assertReceipt,
  boundedErrorCode,
  hasDurableWorkerContinuation,
} from "./outcome-supervision-cycle-checks.js";

export interface OutcomeSupervisionCycleResult {
  disposition: "idle" | "busy" | "blocked" | "changed" | "effect_confirmed" | "uncertain";
  report: OutcomeSupervisionReportV1 | null;
}

/** Composes canonical sources and effects; contains no provider or chat routing. */
export class OutcomeSupervisionRuntime {
  private readonly cursors = new SupervisionCycleCursors();
  private readonly started = new Set<string>();
  private readonly readinessHolds: SupervisionReadinessHolds;

  constructor(private readonly ports: OutcomeSupervisionPorts) {
    this.readinessHolds = new SupervisionReadinessHolds(ports);
  }

  /** Schedules deferred startup evaluation even without another source notification. */
  nextCheckAt(supervisionId: string): number | null {
    const deadline = this.cursors.nextCheckAt(supervisionId);
    return deadline !== null && deadline > Date.parse(this.ports.now()) ? deadline : null;
  }

  async runCycle(supervisionId: string): Promise<OutcomeSupervisionCycleResult> {
    const result = await this.ports.withOwnerLease(supervisionId, async () => {
      const snapshot = await this.ports.readSnapshot(supervisionId);
      if (snapshot.supervisionId !== supervisionId)
        throw new Error("The supervision owner binding changed.");
      const now = this.ports.now();
      const pending = await this.ports.findPendingPlan(supervisionId);
      const preflightBlock =
        pending === null
          ? ((await this.ports.findUnresolvedPreflightBlock?.(supervisionId)) ?? null)
          : null;
      const cursorDigest = supervisionCursorDigest(snapshot.sourceRevisionDigest, preflightBlock);
      const remember = (report: OutcomeSupervisionReportV1, expiresAt: string, blocked = false) =>
        this.cursors.remember(supervisionId, report, expiresAt, blocked, cursorDigest);
      // Only the literal first cycle after start may defer; a first cycle that reconciled a
      // pending decision changed the source, so the next cycle proceeds normally.
      const initial = !this.started.has(supervisionId);
      this.started.add(supervisionId);
      if (
        initial &&
        !this.cursors.has(supervisionId) &&
        this.ports.deferInitialActionUntilChange === true &&
        pending === null &&
        snapshot.evidenceStatus === "valid" &&
        snapshot.authorityStatus === "active" &&
        snapshot.workstreamStatus === "active" &&
        !hasDurableWorkerContinuation(snapshot)
      ) {
        this.cursors.defer(supervisionId, cursorDigest, now);
        return { disposition: "idle" as const, report: null };
      }
      const unchanged = this.cursors.unchanged(supervisionId, cursorDigest, now);
      if (
        snapshot.evidenceStatus === "valid" &&
        snapshot.authorityStatus === "active" &&
        unchanged !== null
      )
        return { disposition: unchanged, report: null };
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
        principal: { actionKinds: mandate.actionKinds, expiresAt: mandate.expiresAt },
      });
      const pendingStartDeadline =
        pending === null ? null : ((await this.ports.readEffectStartDeadline?.(pending)) ?? null);
      const pendingDeadlineElapsed =
        pending !== null &&
        (Date.parse(now) >= Date.parse(pending.deadline) ||
          (pendingStartDeadline !== null && Date.parse(now) >= Date.parse(pendingStartDeadline)) ||
          // An attempt that already ended uncertain will not run again; reconcile it now instead
          // of waiting for its deadline or an unrelated source change.
          (await this.ports.findDecision(operatingDecisionId(pending)))?.status === "uncertain");
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
      if (report.status === "lervo_debt") {
        // Lervo's own held debt is visible in health; it is not owner work and nothing waits on it.
        await this.ports.recordAttention(report, ["lervo_debt", report.reasonCode]);
        remember(report, mandate.expiresAt, true);
        return { disposition: "blocked" as const, report };
      }
      if (report.nextAction === null) {
        remember(report, mandate.expiresAt);
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
        remember(report, mandate.expiresAt, true);
        return { disposition: "blocked" as const, report };
      }
      if (preflightBlock !== null) {
        await this.ports.recordAttention(report, ["preflight_repair_requires_review"]);
        remember(report, mandate.expiresAt, true);
        return { disposition: "blocked" as const, report };
      }
      // A dispatch blocked on worker readiness would only be proposed again until that changes.
      const readinessHold =
        pending === null
          ? await this.readinessHolds.blocking(supervisionId, snapshot.causationEventIds)
          : null;
      if (readinessHold !== null) {
        await this.ports.recordAttention(report, [
          "worker_readiness_unavailable",
          ...readinessHold,
        ]);
        remember(report, mandate.expiresAt, true);
        return { disposition: "blocked" as const, report };
      }
      const plan = pending ?? (await this.ports.propose(report));
      if (plan === null) {
        await this.ports.recordAttention(report, ["owner_plan_unavailable"]);
        remember(report, mandate.expiresAt, true);
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
      if (
        plan.effectContract === "work.owner_attention.v1" &&
        principalEscalationBoundElapsed({
          escalationCount: snapshot.escalationCount,
          attentionPendingSince: snapshot.attentionPendingSince ?? null,
          now,
        })
      ) {
        // Past the bound the owner is never asked again; what the proxy left open is Lervo debt.
        await this.ports.recordAttention(report, ["lervo_debt", "principal_scope_exceeded"]);
        remember(report, mandate.expiresAt, true);
        return { disposition: "blocked" as const, report };
      }
      const mapped = supervisionEffectMapped(
        { reasonCode: report.reasonCode, nextAction: report.nextAction },
        plan,
        mandate.actionKinds,
      );
      if (!mapped) {
        await this.ports.recordAttention(report, ["effect_mapping_unavailable"]);
        return { disposition: "blocked" as const, report };
      }
      const admission = await this.ports.readAdmission(plan);
      this.assertFreshObservation(admission.observedAt);
      const review = reviewOperatingAction({ mandate, plan, snapshot: admission });
      if (review.disposition !== "admitted") {
        await this.ports.recordAttention(report, review.reasonCodes);
        remember(report, mandate.expiresAt, true);
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
          remember(report, mandate.expiresAt);
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
        let readiness: Awaited<ReturnType<OutcomeSupervisionPorts["readWorkerReadiness"]>>;
        try {
          readiness = await this.ports.readWorkerReadiness(plan);
        } catch (error) {
          // A readiness probe that cannot complete blocks the dispatch as an unready one does.
          await this.readinessHolds.hold(
            supervisionId,
            plan,
            ["readiness_unobservable"],
            snapshot.causationEventIds,
          );
          throw error;
        }
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
          await this.readinessHolds.hold(
            supervisionId,
            plan,
            preflight.reasonCodes,
            snapshot.causationEventIds,
          );
          await this.ports.recordAttention(report, preflight.reasonCodes);
          return { disposition: "blocked" as const, report };
        }
      }
      try {
        const effect = await this.ports.execute(plan, freshReview);
        if (operatingReadinessKind(plan) === "worker") this.readinessHolds.release(supervisionId);
        const receipt = {
          ...recorded,
          status: "effect_confirmed" as const,
          effectEventIds: effect.eventIds,
        };
        assertReceipt(receipt, review.decisionId, review.planHash);
        await this.ports.recordEffect(receipt);
        remember(report, mandate.expiresAt);
        return { disposition: "effect_confirmed" as const, report };
      } catch (error) {
        if (error instanceof SupervisionPreflightError) {
          if (error.inspection !== null)
            await this.ports.recordPreflightBlocked?.(recorded, plan, error.inspection);
          await this.ports.recordAttention(report, error.reasonCodes);
          return { disposition: "blocked" as const, report };
        }
        this.ports.reportEffectFailure?.(plan, error);
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
}
