import type {
  OperatingActionPlanV1,
  OperatingPolicyReviewV1,
  SupervisionDecisionReceipt,
  SupervisionPreflightInspectionV1,
} from "@lervo/application-contract";
import { canonicalJson } from "@lervo/event-contract";
import { isDecisionBoundSupervisionEffectEvidence } from "./supervision-effect-evidence.js";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import type { EventEnvelope } from "@lervo/schemas";
import { assertSupersededDecisionProof } from "./supervision-supersession-proof.js";
import {
  assertOperatingActionPlan,
  operatingContractHash,
  operatingDecisionId,
} from "@lervo/work-controller";

import type {
  SQLiteSupervisionOwnerLeaseStore,
  SupervisionOwnerLease,
} from "./supervision-owner-lease.js";

export type { SupervisionJournalCoordinates } from "./supervision-event-journal.js";
import {
  findSupervisionReadinessFailures,
  recordSupervisionReadinessFailure,
  supervisionPayloadFromDecision,
  type SupervisionReadinessFailureRecord,
} from "./supervision-readiness-failure-journal.js";
export type { SupervisionReadinessFailureRecord } from "./supervision-readiness-failure-journal.js";

import {
  SupervisionEventJournal,
  type SupervisionJournalCoordinates,
} from "./supervision-event-journal.js";
import {
  findUnresolvedSupervisionPreflightBlock,
  recordSupervisionPreflightBlocked,
} from "./supervision-preflight-block-journal.js";

/** Stores evidence, never grants authority. The effect adapter must independently admit effects. */
export class SupervisionDecisionJournal {
  private readonly journal: SupervisionEventJournal;

  constructor(
    private readonly events: EventStore,
    artifacts: ArtifactStore,
    private readonly coordinates: SupervisionJournalCoordinates,
    now: () => string,
    fence: { store: SQLiteSupervisionOwnerLeaseStore; lease: SupervisionOwnerLease },
  ) {
    this.coordinates = structuredClone(coordinates);
    this.journal = new SupervisionEventJournal(events, artifacts, coordinates, now, fence);
  }

  async recordDecision(
    plan: OperatingActionPlanV1,
    review: OperatingPolicyReviewV1,
  ): Promise<SupervisionDecisionReceipt> {
    plan = structuredClone(plan);
    review = structuredClone(review);
    assertOperatingActionPlan(plan);
    this.assertPlanBinding(plan);
    const { reviewHash, ...reviewContent } = review;
    if (
      review.schemaVersion !== 1 ||
      reviewHash !== operatingContractHash(reviewContent) ||
      review.planHash !== operatingContractHash(plan) ||
      review.decisionId !== operatingDecisionId(plan) ||
      review.mandateHash !== plan.mandateHash ||
      review.sourceRevisionDigest !== plan.sourceRevisionDigest ||
      review.graphHash !== plan.graphHash ||
      review.kind !== "operating_policy.review" ||
      review.reviewMode !== "mandate_policy_v1" ||
      review.reviewerPolicyId !== "lervo.operating-mandate.v1" ||
      review.disposition !== "admitted" ||
      !/^sha256:[a-f0-9]{64}$/u.test(review.installationReviewHash ?? "") ||
      !/^sha256:[a-f0-9]{64}$/u.test(review.snapshotHash) ||
      !Array.isArray(review.reasonCodes) ||
      review.reasonCodes.length !== 0
    )
      throw new Error("The supervision decision is not bound to its exact admitted review.");
    const planArtifactHash = await this.journal.put(plan);
    const policyReviewHash = await this.journal.put(review);
    const payload = {
      ...this.common(plan),
      decisionId: review.decisionId,
      sourceRevisionDigest: plan.sourceRevisionDigest,
      actionKind: plan.actionKind,
      planHash: review.planHash,
      planArtifactHash,
      rationaleArtifactHash: plan.rationaleArtifactHash,
      policyReviewHash,
      disposition: review.disposition,
    };
    this.journal.append("work.supervision.decision.recorded", payload, review.decisionId);
    return this.findDecision(review.decisionId)!;
  }

  findDecision(
    decisionId: string,
    history: readonly EventEnvelope[] = this.journal.history(),
  ): SupervisionDecisionReceipt | null {
    const event = this.events.get(
      this.journal.eventId("work.supervision.decision.recorded", decisionId),
    );
    if (event === null) return null;
    this.journal.assertEventBinding(event);
    const receipt: SupervisionDecisionReceipt = {
      decisionId,
      planHash: String(event.payload.planHash),
      status: "recorded",
      effectEventIds: [],
    };
    for (const observation of history) {
      if (
        observation.type === "work.supervision.decision.superseded" &&
        observation.payload.decisionId === decisionId
      ) {
        this.journal.assertEventBinding(observation);
        if (
          observation.payload.planHash !== receipt.planHash ||
          receipt.status === "effect_confirmed"
        )
          throw new Error("A superseded decision conflicts with confirmed execution.");
        receipt.status = "superseded";
        receipt.effectEventIds = [];
        continue;
      }
      if (
        observation.type !== "work.supervision.effect.observed" ||
        observation.payload.decisionId !== decisionId
      )
        continue;
      this.journal.assertEventBinding(observation);
      if (
        observation.payload.planHash !== receipt.planHash ||
        (receipt.status === "effect_confirmed" &&
          observation.payload.status !== "effect_confirmed") ||
        receipt.status === "superseded"
      )
        throw new Error("The supervision effect history conflicts with its decision.");
      receipt.status = observation.payload.status as SupervisionDecisionReceipt["status"];
      receipt.effectEventIds = [...(observation.payload.effectEventIds as string[])];
    }
    return receipt;
  }

  /** Includes old-source unresolved decisions: a source change cannot discard an uncertain effect. */
  async findPendingPlan(): Promise<OperatingActionPlanV1 | null> {
    // One verified snapshot serves every decision; rereading it per decision is quadratic.
    const history = this.journal.history();
    for (const event of history) {
      if (event.type !== "work.supervision.decision.recorded") continue;
      const receipt = this.findDecision(String(event.payload.decisionId), history);
      if (receipt?.status === "effect_confirmed") continue;
      if (receipt?.status === "superseded") {
        await assertSupersededDecisionProof({
          journal: this.journal,
          events: this.events,
          receipt,
          readPlan: () => this.readPlan(String(event.payload.planArtifactHash)),
        });
        continue;
      }
      this.journal.assertEventBinding(event);
      const plan = await this.readPlan(String(event.payload.planArtifactHash));
      if (operatingContractHash(plan) !== event.payload.planHash)
        throw new Error("The recovered supervision plan differs from its canonical decision.");
      return plan;
    }
    return null;
  }

  recordEffect(receipt: SupervisionDecisionReceipt): void {
    const current = this.findDecision(receipt.decisionId);
    if (
      current === null ||
      current.planHash !== receipt.planHash ||
      receipt.status === "recorded" ||
      receipt.status === "superseded" ||
      current.status === "superseded" ||
      (current.status === "effect_confirmed" && canonicalJson(current) !== canonicalJson(receipt))
    )
      throw new Error("The supervision effect conflicts with its canonical decision.");
    const decision = this.events.get(
      this.journal.eventId("work.supervision.decision.recorded", receipt.decisionId),
    )!;
    for (const eventId of receipt.effectEventIds) {
      const evidence = this.events.get(eventId);
      if (
        evidence === null ||
        evidence.projectId !== this.coordinates.projectId ||
        evidence.seq <= decision.seq ||
        (evidence.type.startsWith("work.supervision.") &&
          !isDecisionBoundSupervisionEffectEvidence(evidence, decision, this.events))
      )
        throw new Error("The supervision effect evidence is unavailable or noncausal.");
    }
    // Existence and ordering do not establish effect identity; the concrete inspector owns that check.
    this.journal.append(
      "work.supervision.effect.observed",
      { ...supervisionPayloadFromDecision(decision), ...receipt },
      operatingContractHash(receipt),
    );
  }

  /** Canonical safe non-start evidence; see the readiness-failure journal for its bounds. */
  recordReadinessFailure(
    receipt: SupervisionDecisionReceipt,
    failure: SupervisionReadinessFailureRecord,
  ): Promise<string> {
    return recordSupervisionReadinessFailure({
      journal: this.journal,
      events: this.events,
      findDecision: (id) => this.findDecision(id),
      receipt,
      failure,
    });
  }

  recordPreflightBlocked(
    receipt: SupervisionDecisionReceipt,
    plan: OperatingActionPlanV1,
    inspection: SupervisionPreflightInspectionV1,
  ): Promise<string> {
    return recordSupervisionPreflightBlocked({
      journal: this.journal,
      events: this.events,
      findDecision: (id) => this.findDecision(id),
      receipt,
      plan,
      inspection,
    });
  }

  findUnresolvedPreflightBlock() {
    return findUnresolvedSupervisionPreflightBlock({
      events: this.events,
      coordinates: this.coordinates,
    });
  }

  findReadinessFailures(decisionId: string) {
    return findSupervisionReadinessFailures(this.journal, decisionId);
  }

  private async readPlan(hash: string): Promise<OperatingActionPlanV1> {
    const plan = (await this.journal.read(hash)) as OperatingActionPlanV1;
    assertOperatingActionPlan(plan);
    return plan;
  }

  private common(plan: OperatingActionPlanV1): Record<string, unknown> {
    return {
      schemaVersion: 1,
      projectId: plan.projectId,
      workstreamId: plan.workstreamId,
      workstreamRevision: this.coordinates.workstreamRevision,
      supervisionId: plan.supervisionId,
      ownerAgentId: plan.ownerAgentId,
      mandateHash: plan.mandateHash,
      causationEventIds: plan.causationEventIds,
    };
  }

  private assertPlanBinding(plan: OperatingActionPlanV1): void {
    for (const key of [
      "projectId",
      "workstreamId",
      "supervisionId",
      "ownerAgentId",
      "mandateHash",
    ] as const)
      if (plan[key] !== this.coordinates[key])
        throw new Error("The supervision plan binding changed.");
    for (const eventId of plan.causationEventIds)
      if (this.events.get(eventId)?.projectId !== plan.projectId)
        throw new Error("The supervision cause is unavailable.");
  }
}
