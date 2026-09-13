import type {
  OperatingActionPlanV1,
  OperatingPolicyReviewV1,
  SupervisedArtifactReviewV1,
  SupervisedAssignmentObservationV1,
} from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import {
  assertOperatingActionPlan,
  assertSupervisedArtifactReview,
  assertSupervisedReviewBasis,
  operatingContractHash,
  operatingDecisionId,
  supervisedArtifactReviewPayload,
} from "@lervo/work-controller";
import {
  SupervisionEventJournal,
  type SupervisionJournalCoordinates,
} from "./supervision-event-journal.js";
import type {
  SQLiteSupervisionOwnerLeaseStore,
  SupervisionOwnerLease,
} from "./supervision-owner-lease.js";

/** Persists an explicit owner verdict. This neither runs a reviewer nor completes or delivers work. */
export class SupervisionArtifactReviewJournal {
  private readonly journal: SupervisionEventJournal;
  private readonly coordinates: SupervisionJournalCoordinates;

  constructor(
    private readonly events: EventStore,
    artifacts: ArtifactStore,
    coordinates: SupervisionJournalCoordinates,
    now: () => string,
    fence: { store: SQLiteSupervisionOwnerLeaseStore; lease: SupervisionOwnerLease } | null,
  ) {
    this.coordinates = structuredClone(coordinates);
    this.journal = new SupervisionEventJournal(events, artifacts, coordinates, now, fence);
  }

  async record(input: {
    plan: OperatingActionPlanV1;
    effect: SupervisedArtifactReviewV1;
    assignment: SupervisedAssignmentObservationV1;
    /** Synchronous source and authority fence, called inside the event transaction. */
    validateCurrent: () => void;
  }): Promise<{ eventIds: string[] }> {
    const { plan, effect, assignment } = structuredClone({
      plan: input.plan,
      effect: input.effect,
      assignment: input.assignment,
    });
    const expected = await this.expected(plan, effect);
    assertSupervisedReviewBasis(effect, assignment);
    await this.journal.put(effect);
    this.journal.append(
      "work.supervision.review.recorded",
      expected.payload,
      operatingDecisionId(plan),
      input.validateCurrent,
    );
    return { eventIds: [expected.eventId] };
  }

  async inspect(plan: OperatingActionPlanV1, effect: SupervisedArtifactReviewV1) {
    plan = structuredClone(plan);
    effect = structuredClone(effect);
    const expected = await this.expected(plan, effect);
    const event = this.events.get(expected.eventId);
    if (event === null) return { status: "not_started" as const };
    this.journal.assertEventBinding(event);
    if (
      event.actor.kind !== "system" ||
      event.type !== "work.supervision.review.recorded" ||
      event.seq <= expected.decision.seq ||
      operatingContractHash(event.payload) !== operatingContractHash(expected.payload)
    )
      throw new Error("The owner review event conflicts with its exact decision.");
    return { status: "confirmed" as const, eventIds: [event.eventId] };
  }

  private async expected(plan: OperatingActionPlanV1, effect: SupervisedArtifactReviewV1) {
    assertOperatingActionPlan(plan);
    assertSupervisedArtifactReview(effect, plan);
    for (const key of [
      "projectId",
      "workstreamId",
      "supervisionId",
      "ownerAgentId",
      "mandateHash",
    ] as const)
      if (plan[key] !== this.coordinates[key])
        throw new Error("The owner review belongs to another supervision binding.");
    const decisionId = operatingDecisionId(plan);
    const decision = this.events.get(
      this.journal.eventId("work.supervision.decision.recorded", decisionId),
    );
    if (decision === null) throw new Error("The owner review requires a recorded policy decision.");
    this.journal.assertEventBinding(decision);
    const recordedPlan = await this.journal.read(String(decision.payload.planArtifactHash));
    const policy = (await this.journal.read(
      String(decision.payload.policyReviewHash),
    )) as OperatingPolicyReviewV1;
    const { reviewHash, ...reviewContent } = policy;
    const rationale = await this.journal.read(effect.rationaleArtifactHash);
    if (typeof rationale !== "string" || rationale.trim().length === 0)
      throw new Error("The owner review requires a nonempty governed rationale artifact.");
    const terminal = this.events.get(effect.terminalEventId);
    if (
      decision.type !== "work.supervision.decision.recorded" ||
      decision.actor.kind !== "system" ||
      operatingContractHash(recordedPlan) !== operatingContractHash(plan) ||
      decision.payload.planHash !== operatingContractHash(plan) ||
      decision.payload.actionKind !== plan.actionKind ||
      decision.payload.decisionId !== decisionId ||
      decision.payload.disposition !== "admitted" ||
      policy.schemaVersion !== 1 ||
      !/^sha256:[a-f0-9]{64}$/u.test(policy.installationReviewHash ?? "") ||
      policy.planHash !== operatingContractHash(plan) ||
      policy.decisionId !== decisionId ||
      policy.mandateHash !== plan.mandateHash ||
      policy.sourceRevisionDigest !== plan.sourceRevisionDigest ||
      policy.graphHash !== plan.graphHash ||
      policy.kind !== "operating_policy.review" ||
      policy.reviewMode !== "mandate_policy_v1" ||
      policy.reviewerPolicyId !== "lervo.operating-mandate.v1" ||
      policy.disposition !== "admitted" ||
      policy.reasonCodes.length !== 0 ||
      reviewHash !== operatingContractHash(reviewContent) ||
      terminal === null ||
      terminal.projectId !== plan.projectId ||
      terminal.type !== "run.completed" ||
      terminal.seq >= decision.seq ||
      this.events.get(this.journal.eventId("work.supervision.decision.superseded", decisionId)) !==
        null
    )
      throw new Error("The owner review decision has stale or inconsistent evidence.");
    return {
      decision,
      eventId: this.journal.eventId("work.supervision.review.recorded", decisionId),
      payload: supervisedArtifactReviewPayload(
        effect,
        plan,
        Number(decision.payload.workstreamRevision),
        decision.eventId,
      ),
    };
  }
}
