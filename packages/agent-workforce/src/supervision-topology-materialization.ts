import type {
  AssignmentTopologyPlanV2,
  AutomaticTopologyEffectV1,
  OperatingActionPlanV1,
  OperatingPolicyReviewV1,
} from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import {
  assertOperatingActionPlan,
  automaticTopologyEffectFields,
  automaticTopologyReviewerDigest,
  operatingContractHash,
  operatingDecisionId,
  operatingEffectAdmissionHash,
} from "@lervo/work-controller";
import { topologyAssignmentMatches } from "./assignment-topology-state.js";
import { createTopologyAssignment, listAssignments, withAssignmentTopologyLock } from "./store.js";
import type { WorkforceAssignment } from "./types.js";
import {
  SupervisionEventJournal,
  type SupervisionJournalCoordinates,
} from "./supervision-event-journal.js";
import type {
  SQLiteSupervisionOwnerLeaseStore,
  SupervisionOwnerLease,
} from "./supervision-owner-lease.js";

/** Persists one admitted structural addition; dispatch requires a separate responsibility claim. */
export class SupervisionTopologyMaterializer {
  private readonly journal: SupervisionEventJournal;
  private readonly coordinates: SupervisionJournalCoordinates;
  private readonly fence: { store: SQLiteSupervisionOwnerLeaseStore; lease: SupervisionOwnerLease };

  constructor(
    private readonly repositoryRoot: string,
    private readonly events: EventStore,
    artifacts: ArtifactStore,
    coordinates: SupervisionJournalCoordinates,
    private readonly now: () => string,
    fence: { store: SQLiteSupervisionOwnerLeaseStore; lease: SupervisionOwnerLease },
  ) {
    this.coordinates = structuredClone(coordinates);
    this.fence = { store: fence.store, lease: structuredClone(fence.lease) };
    this.journal = new SupervisionEventJournal(events, artifacts, coordinates, now, fence);
  }

  private async expected(effect: AutomaticTopologyEffectV1, plan: OperatingActionPlanV1) {
    assertOperatingActionPlan(plan);
    const actual = automaticTopologyEffectFields(effect);
    if (
      operatingEffectAdmissionHash(plan) !== operatingEffectAdmissionHash({ ...plan, ...actual }) ||
      plan.supervisionId !== this.coordinates.supervisionId ||
      plan.projectId !== this.coordinates.projectId ||
      plan.workstreamId !== this.coordinates.workstreamId ||
      plan.ownerAgentId !== this.coordinates.ownerAgentId ||
      plan.mandateHash !== this.coordinates.mandateHash ||
      plan.graphHash !== effect.topology.currentGraphHash ||
      effect.topology.projectId !== plan.projectId ||
      effect.request.workstreamId !== plan.workstreamId ||
      effect.responsibility.reviewerAgentId !== plan.ownerAgentId
    )
      throw new Error("The automatic topology effect differs from its admitted scope.");
    const decisionId = operatingDecisionId(plan);
    const decision = this.events.get(
      this.journal.eventId("work.supervision.decision.recorded", decisionId),
    );
    if (decision === null)
      throw new Error("Automatic topology requires a recorded policy decision.");
    this.journal.assertEventBinding(decision);
    if (
      this.events.get(this.journal.eventId("work.supervision.decision.superseded", decisionId)) !==
      null
    )
      throw new Error("The automatic topology decision was superseded.");
    const recordedPlan = await this.journal.read(String(decision.payload.planArtifactHash));
    const review = (await this.journal.read(
      String(decision.payload.policyReviewHash),
    )) as OperatingPolicyReviewV1;
    const { reviewHash, ...reviewContent } = review;
    if (
      operatingContractHash(recordedPlan) !== operatingContractHash(plan) ||
      decision.payload.planHash !== operatingContractHash(plan) ||
      decision.payload.decisionId !== decisionId ||
      review.planHash !== operatingContractHash(plan) ||
      review.decisionId !== decisionId ||
      review.reviewMode !== "mandate_policy_v1" ||
      review.reviewerPolicyId !== "lervo.operating-mandate.v1" ||
      review.disposition !== "admitted" ||
      review.reasonCodes.length !== 0 ||
      reviewHash !== operatingContractHash(reviewContent)
    )
      throw new Error("The canonical topology decision or policy review is inconsistent.");
    const node = effect.request.nodes[0]!;
    const topology = effect.topology;
    const step = topology.steps[0]!;
    return {
      decision,
      eventId: this.journal.eventId("assignment.created", decisionId),
      assignmentId: step.assignmentId,
      input: {
        repositoryRoot: this.repositoryRoot,
        ...node,
        dependencyIds: [...step.dependencyIds].sort(),
        verificationSuiteIds: [...node.verificationSuiteIds].sort(),
        approvalRequirements: [...node.approvalRequirements].sort(),
        expectedPaths: [...node.expectedPaths].sort(),
        workstreamId: topology.workstreamId,
        topology: {
          contractVersion: 2 as const,
          changeId: topology.changeId,
          changeKey: topology.changeKey,
          requestHash: topology.requestHash,
          planId: topology.planId,
          approvalHash: topology.approvalHash,
          reviewerIdDigest: automaticTopologyReviewerDigest,
          expectedNodeCount: 1,
          nodeSetHash: operatingContractHash([node.nodeKey]),
          nodeKey: node.nodeKey,
          policyReview: { schemaVersion: 1 as const, decisionId, reviewHash },
        },
      },
    };
  }

  async inspect(
    effect: AutomaticTopologyEffectV1,
    plan: OperatingActionPlanV1,
  ): Promise<
    { status: "confirmed"; effectEventIds: string[] } | { status: "not_started" | "uncertain" }
  > {
    const expected = await this.expected(structuredClone(effect), structuredClone(plan));
    const assignment = (await listAssignments(this.repositoryRoot)).find(
      (item) => item.assignmentId === expected.assignmentId,
    );
    const event = this.events.get(expected.eventId);
    if (assignment === undefined && event === null) return { status: "not_started" };
    if (
      assignment === undefined ||
      event === null ||
      !topologyAssignmentMatches(assignment, expected.input) ||
      assignment.topology?.planId !== effect.topology.planId ||
      event.type !== "assignment.created" ||
      event.schemaVersion !== 3 ||
      event.projectId !== plan.projectId ||
      event.seq <= expected.decision.seq ||
      event.payload.assignmentId !== assignment.assignmentId ||
      event.payload.topologyPolicyDecisionId !== expected.input.topology.policyReview.decisionId ||
      event.payload.topologyPolicyReviewHash !== expected.input.topology.policyReview.reviewHash ||
      event.payload.topologyRequestHash !== expected.input.topology.requestHash ||
      event.payload.topologyPlanId !== expected.input.topology.planId ||
      event.payload.initialStatus !== "blocked"
    )
      return { status: "uncertain" };
    return { status: "confirmed", effectEventIds: [event.eventId] };
  }

  async supersedeNotStarted(
    effect: AutomaticTopologyEffectV1,
    plan: OperatingActionPlanV1,
    sourceRevisionDigest: string,
  ) {
    effect = structuredClone(effect);
    plan = structuredClone(plan);
    if (
      !/^sha256:[a-f0-9]{64}$/u.test(sourceRevisionDigest) ||
      sourceRevisionDigest === plan.sourceRevisionDigest
    )
      throw new Error("Topology supersession requires a changed exact source.");
    const expected = await this.expected(effect, plan);
    return withAssignmentTopologyLock({
      repositoryRoot: this.repositoryRoot,
      operation: async () => {
        const inspection = await this.inspect(effect, plan);
        if (inspection.status !== "not_started") return false;
        const observedAt = this.now();
        const assignments = await listAssignments(this.repositoryRoot);
        if (assignments.some((item) => item.assignmentId === expected.assignmentId)) return false;
        const inspectionArtifactHash = await this.journal.put({
          schemaVersion: 1,
          kind: "work.effect_absence",
          decisionId: operatingDecisionId(plan),
          planHash: operatingContractHash(plan),
          effectHash: plan.effectHash,
          assignmentId: expected.assignmentId,
          sourceRevisionDigest,
          assignmentSourceHash: operatingContractHash(assignments),
          eventHeadHash: this.events.latest()?.eventHash ?? null,
          observedAt,
          assignmentAbsent: true,
          creationEventAbsent: true,
        });
        if (
          operatingContractHash(await listAssignments(this.repositoryRoot)) !==
          operatingContractHash(assignments)
        )
          throw new Error("Topology absence changed before supersession.");
        this.journal.append(
          "work.supervision.decision.superseded",
          {
            schemaVersion: 1,
            projectId: plan.projectId,
            workstreamId: plan.workstreamId,
            workstreamRevision: this.coordinates.workstreamRevision,
            supervisionId: plan.supervisionId,
            ownerAgentId: plan.ownerAgentId,
            mandateHash: plan.mandateHash,
            causationEventIds: [expected.decision.eventId],
            decisionId: operatingDecisionId(plan),
            planHash: operatingContractHash(plan),
            inspectionArtifactHash,
            sourceRevisionDigest,
          },
          operatingDecisionId(plan),
          () => {
            const age = Date.parse(this.now()) - Date.parse(observedAt);
            if (
              !Number.isFinite(age) ||
              age < 0 ||
              age > 5000 ||
              this.events.get(expected.eventId) !== null ||
              this.journal
                .history()
                .some(
                  (event) =>
                    event.type === "work.supervision.effect.observed" &&
                    event.payload.decisionId === operatingDecisionId(plan) &&
                    event.payload.status === "effect_confirmed",
                )
            )
              throw new Error("Topology supersession inspection is stale.");
          },
        );
        return true;
      },
    });
  }

  async materialize(
    effect: AutomaticTopologyEffectV1,
    plan: OperatingActionPlanV1,
    currentTopology: () => Promise<AssignmentTopologyPlanV2>,
    revalidate: (assignment: WorkforceAssignment | null) => Promise<void>,
  ) {
    effect = structuredClone(effect);
    plan = structuredClone(plan);
    const expected = await this.expected(effect, plan);
    return withAssignmentTopologyLock({
      repositoryRoot: this.repositoryRoot,
      operation: async () => {
        const inspection = await this.inspect(effect, plan);
        if (inspection.status === "confirmed") return inspection;
        if (inspection.status === "uncertain")
          throw new Error("The topology effect requires reconciliation.");
        const observedAt = this.now();
        if (
          operatingContractHash(await currentTopology()) !== operatingContractHash(effect.topology)
        )
          throw new Error("The automatic topology structural source changed.");
        await revalidate(null);
        const fresh = () => {
          const age = Date.parse(this.now()) - Date.parse(observedAt);
          if (!Number.isFinite(age) || age < 0 || age > 5000)
            throw new Error("The automatic topology admission is stale.");
        };
        fresh();
        await createTopologyAssignment({
          ...expected.input,
          now: new Date(this.now()),
          recordEvent: async (event) => {
            const assignment = (await listAssignments(this.repositoryRoot)).find(
              (item) => item.assignmentId === expected.assignmentId,
            );
            if (
              assignment === undefined ||
              assignment.revision !== 1 ||
              assignment.status !== "blocked" ||
              assignment.lease !== null ||
              !topologyAssignmentMatches(assignment, expected.input) ||
              event.type !== "assignment.created" ||
              event.payload.assignmentId !== expected.assignmentId
            )
              throw new Error("The created topology assignment differs from its decision.");
            await revalidate(structuredClone(assignment));
            const latest = (await listAssignments(this.repositoryRoot)).find(
              (item) => item.assignmentId === expected.assignmentId,
            );
            if (operatingContractHash(latest) !== operatingContractHash(assignment))
              throw new Error("The created topology assignment changed before commit.");
            fresh();
            this.fence.store.commit(this.fence.lease, Date.parse(this.now()), () => {
              if (this.journal.history().length >= 4096)
                throw new Error("The supervision journal requires compaction.");
              this.events.transact((transaction) => {
                const result = transaction.append(
                  this.journal.draft(
                    "assignment.created",
                    event.payload,
                    expected.input.topology.policyReview.decisionId,
                  ),
                );
                if (result.redactions.length > 0)
                  throw new Error("The topology evidence was redacted.");
              });
            });
          },
        });
        const recorded = await this.inspect(effect, plan);
        if (recorded.status !== "confirmed")
          throw new Error("The created topology requires recorded-effect inspection.");
        return recorded;
      },
    });
  }
}
