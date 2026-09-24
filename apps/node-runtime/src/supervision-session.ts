import type {
  OperatingActionPlanV1,
  AutomaticTopologyEffectV1,
  AssignmentTopologyPlanV2,
  OperatingPolicyReviewV1,
  SupervisionDecisionReceipt,
  SupervisionPreflightInspectionV1,
  SupervisedManagedExecution,
  SupervisedArtifactReviewV1,
  SupervisedGoalCompletionV1,
} from "@lervo/application-contract";
import {
  SupervisionDecisionJournal,
  SupervisionArtifactReviewJournal,
  SupervisionTopologyMaterializer,
  SupervisionResponsibilityReader,
  SupervisionResponsibilityClaimer,
  type SupervisionResponsibilityClaim,
  type WorkforceAssignment,
  type SQLiteSupervisionOwnerLeaseStore,
  type SupervisionOwnerLease,
  type SupervisionReadinessFailureRecord,
} from "@lervo/agent-workforce";
import { createSessionResponsibilityOperations } from "./supervision-session-responsibility.js";
import { type ProjectStorage } from "@lervo/project-storage";
import { SupervisionAuthorityHistory } from "./supervision-authority-history.js";
import { SupervisionTaskSource } from "./supervision-task-source.js";
import {
  bindSupervisionRequest,
  type SupervisionRequestInput,
} from "./supervision-request-binding.js";
import { recordCanonicalArtifactReview } from "./supervision-artifact-review.js";
import { recordCanonicalGoalCompletion } from "./supervision-goal-completion.js";
import { reconcileSupervisionCancellation } from "./supervision-cancellation.js";
import { operatingDecisionId } from "@lervo/work-controller";
import type { SupervisedManagedInvocation } from "./supervision-managed-admission.js";
import {
  NodeSupervisionError,
  observeNodeSupervisionAuthority,
  observeNodeSupervisionRecoveryAuthority,
  readInstalledNodeMandate,
  supervisionJournalCoordinates,
  type NodeSupervisionBinding,
} from "./supervision-authority.js";

export interface NodeSupervisionSession {
  bindRequest(request: SupervisionRequestInput): Promise<{ eventId: string; duplicate: boolean }>;
  reconcileCancellation(
    snapshot: Parameters<typeof reconcileSupervisionCancellation>[0]["snapshot"],
  ): ReturnType<typeof reconcileSupervisionCancellation>;
  recordGoalCompletion(
    plan: OperatingActionPlanV1,
    effect: SupervisedGoalCompletionV1,
    authorityDigest: string,
  ): Promise<{ eventIds: string[] }>;
  readOwnerControlReadiness(
    plan: OperatingActionPlanV1,
  ): ReturnType<SupervisionTaskSource["readOwnerControlReadiness"]>;
  recordArtifactReview(
    plan: OperatingActionPlanV1,
    effect: SupervisedArtifactReviewV1,
    authorityDigest: string,
  ): Promise<{ eventIds: string[] }>;
  readTaskResponsibility(plan: OperatingActionPlanV1): Promise<{
    responsibility: NonNullable<
      Awaited<ReturnType<SupervisionResponsibilityReader["current"]>>
    >["responsibility"];
    workstreamRevision: number;
  }>;
  readTaskSnapshot(excludeDecisionId?: string): ReturnType<SupervisionTaskSource["readSnapshot"]>;
  readTaskAdmission(
    plan: OperatingActionPlanV1,
  ): ReturnType<SupervisionTaskSource["readAdmission"]>;
  managedInvocation(
    plan: OperatingActionPlanV1,
    effect: SupervisedManagedExecution,
    authorityDigest: string,
  ): SupervisedManagedInvocation;
  materializeTopology(
    effect: AutomaticTopologyEffectV1,
    plan: OperatingActionPlanV1,
    authorityDigest: string,
    currentTopology: () => Promise<AssignmentTopologyPlanV2>,
    revalidate: (assignment: WorkforceAssignment | null) => Promise<void>,
  ): ReturnType<SupervisionTopologyMaterializer["materialize"]>;
  supersedeTopology(
    effect: AutomaticTopologyEffectV1,
    plan: OperatingActionPlanV1,
    sourceRevisionDigest: string,
  ): Promise<boolean>;
  inspectTopology(
    effect: AutomaticTopologyEffectV1,
    plan: OperatingActionPlanV1,
  ): ReturnType<SupervisionTopologyMaterializer["inspect"]>;
  /** Revalidates repository authority around the exact claim; the adapter owns effect admission. */
  claimResponsibility(
    input: SupervisionResponsibilityClaim,
    authorityDigest: string,
    revalidate: (assignment: WorkforceAssignment) => Promise<void>,
  ): ReturnType<SupervisionResponsibilityClaimer["claim"]>;
  /** Extends the executor's exact live lease during an observed managed run; never claims. */
  renewWorkerLease(input: {
    assignmentId: string;
    agentId: string;
    leaseId: string;
    leaseDurationMs: number;
  }): Promise<WorkforceAssignment | null>;
  readResponsibility(assignmentId: string): ReturnType<SupervisionResponsibilityReader["current"]>;
  readMandate(): ReturnType<typeof readInstalledNodeMandate>;
  readAuthority(): ReturnType<typeof observeNodeSupervisionAuthority>;
  readRecoveryAuthority(): ReturnType<typeof observeNodeSupervisionRecoveryAuthority>;
  findPendingPlan(): Promise<OperatingActionPlanV1 | null>;
  findDecision(decisionId: string): SupervisionDecisionReceipt | null;
  recordDecision(
    plan: OperatingActionPlanV1,
    review: OperatingPolicyReviewV1,
    authorityDigest: string,
  ): Promise<SupervisionDecisionReceipt>;
  recordEffect(receipt: SupervisionDecisionReceipt): void;
  recordReadinessFailure(
    receipt: SupervisionDecisionReceipt,
    failure: SupervisionReadinessFailureRecord,
  ): Promise<string>;
  recordPreflightBlocked(
    receipt: SupervisionDecisionReceipt,
    plan: OperatingActionPlanV1,
    inspection: SupervisionPreflightInspectionV1,
  ): Promise<string>;
  findUnresolvedPreflightBlock(): {
    eventId: string;
    decisionId: string;
    reasonCode: string;
  } | null;
  /** Renewal invalidates earlier fence coordinates; callers must settle any journal write first. */
  renew(): void;
  /** Storage fence only. The effect adapter still owns exact admission at its commit boundary. */
  commit<T>(effect: () => T): T;
}

/** One lease-bound session; journal and authority operations cannot outlive its owner operation. */
export function createNodeSupervisionSession(context: {
  storage: ProjectStorage;
  leases: SQLiteSupervisionOwnerLeaseStore;
  binding: NodeSupervisionBinding;
  now: () => string;
  tasks: SupervisionTaskSource;
  authorityHistory: SupervisionAuthorityHistory;
  acquired: SupervisionOwnerLease;
}) {
  let lease: SupervisionOwnerLease = context.acquired;
  let open = true;
  const assertOpen = () => {
    if (!open) throw new NodeSupervisionError("supervision_session_closed");
  };
  const journal = (revision = 1) => {
    assertOpen();
    return new SupervisionDecisionJournal(
      context.storage.events,
      context.storage.artifacts,
      supervisionJournalCoordinates(context.storage, context.binding, revision),
      context.now,
      { store: context.leases, lease },
    );
  };
  const topologyMaterializer = (revision: number) =>
    new SupervisionTopologyMaterializer(
      context.storage.paths.repositoryRoot,
      context.storage.events,
      context.storage.artifacts,
      supervisionJournalCoordinates(context.storage, context.binding, revision),
      context.now,
      { store: context.leases, lease },
    );
  const responsibility = createSessionResponsibilityOperations({
    storage: context.storage,
    leases: context.leases,
    binding: context.binding,
    now: context.now,
    assertOpen,
    currentLease: () => lease,
    readAuthority: () => session.readAuthority(),
  });
  const session: NodeSupervisionSession = {
    bindRequest: (request) => {
      assertOpen();
      return bindSupervisionRequest({
        storage: context.storage,
        tasks: context.tasks,
        binding: context.binding,
        now: context.now,
        commit: session.commit,
        request,
      });
    },
    reconcileCancellation: (snapshot) => {
      assertOpen();
      return reconcileSupervisionCancellation({
        storage: context.storage,
        tasks: context.tasks,
        binding: context.binding,
        snapshot,
        session,
        now: context.now,
      });
    },
    recordGoalCompletion: (plan, effect, authorityDigest) => {
      assertOpen();
      return recordCanonicalGoalCompletion({
        storage: context.storage,
        tasks: context.tasks,
        binding: context.binding,
        now: context.now,
        plan,
        effect,
        authorityDigest,
        session,
      });
    },
    readOwnerControlReadiness: async (plan) => {
      assertOpen();
      const observation = await context.tasks.readOwnerControlReadiness(plan);
      assertOpen();
      return observation;
    },
    recordArtifactReview: (plan, effect, authorityDigest) => {
      assertOpen();
      return recordCanonicalArtifactReview({
        storage: context.storage,
        tasks: context.tasks,
        binding: context.binding,
        plan,
        effect,
        authorityDigest,
        session,
        assertOpen,
        now: context.now,
        journal: (revision) =>
          new SupervisionArtifactReviewJournal(
            context.storage.events,
            context.storage.artifacts,
            supervisionJournalCoordinates(context.storage, context.binding, revision),
            context.now,
            { store: context.leases, lease },
          ),
      });
    },
    readTaskResponsibility: async (plan) => {
      assertOpen();
      const source = await context.tasks.read(operatingDecisionId(plan));
      assertOpen();
      const matches = source.responsibilities.filter(
        (item) => item.binding?.responsibilityHash === plan.responsibilityArtifactHash,
      );
      if (matches.length !== 1) throw new NodeSupervisionError("supervision_readiness_changed");
      return {
        responsibility: matches[0]!.binding!.responsibility,
        workstreamRevision: source.workstream.revision,
      };
    },
    readTaskSnapshot: async (excludeDecisionId) => {
      assertOpen();
      const snapshot = await context.tasks.readSnapshot(excludeDecisionId);
      assertOpen();
      return snapshot;
    },
    readTaskAdmission: async (plan) => {
      assertOpen();
      const admission = await context.tasks.readAdmission(plan);
      assertOpen();
      return admission;
    },
    materializeTopology: async (effect, plan, authorityDigest, currentTopology, revalidate) => {
      assertOpen();
      const authority = await session.readAuthority();
      assertOpen();
      if (authority.source.sourceRevisionDigest !== authorityDigest)
        throw new NodeSupervisionError("supervision_authority_changed");
      return topologyMaterializer(authority.source.workstreamRevision).materialize(
        effect,
        plan,
        currentTopology,
        async (assignment) => {
          assertOpen();
          await revalidate(assignment);
          const current = await session.readAuthority();
          assertOpen();
          if (current.source.sourceRevisionDigest !== authorityDigest)
            throw new NodeSupervisionError("supervision_authority_changed");
        },
      );
    },
    supersedeTopology: async (effect, plan, sourceRevisionDigest) => {
      assertOpen();
      const authority = await session.readAuthority();
      assertOpen();
      return topologyMaterializer(authority.source.workstreamRevision).supersedeNotStarted(
        effect,
        plan,
        sourceRevisionDigest,
      );
    },
    inspectTopology: async (effect, plan) => {
      assertOpen();
      const authority = await session.readAuthority();
      assertOpen();
      return topologyMaterializer(authority.source.workstreamRevision).inspect(effect, plan);
    },
    ...responsibility,
    readMandate: async () => {
      assertOpen();
      return readInstalledNodeMandate(context.storage, context.binding, context.now);
    },
    readAuthority: async () => {
      assertOpen();
      return observeNodeSupervisionAuthority(
        context.storage,
        context.binding,
        context.now,
        context.authorityHistory,
      );
    },
    readRecoveryAuthority: async () => {
      assertOpen();
      return observeNodeSupervisionRecoveryAuthority(
        context.storage,
        context.binding,
        context.now,
        context.authorityHistory,
      );
    },
    findPendingPlan: async () => journal().findPendingPlan(),
    findDecision: (id) => journal().findDecision(id),
    recordDecision: async (plan, review, authorityDigest) => {
      assertOpen();
      plan = structuredClone(plan);
      review = structuredClone(review);
      const authority = await session.readAuthority();
      assertOpen();
      if (
        review.installationReviewHash !== authority.installation.installationReviewHash ||
        authorityDigest !== authority.source.sourceRevisionDigest
      )
        throw new NodeSupervisionError("supervision_authority_changed");
      return journal(authority.source.workstreamRevision).recordDecision(plan, review);
    },
    recordEffect: (receipt) => journal().recordEffect(receipt),
    recordReadinessFailure: (receipt, failure) => {
      assertOpen();
      return journal().recordReadinessFailure(receipt, failure);
    },
    recordPreflightBlocked: (receipt, plan, inspection) => {
      assertOpen();
      return journal().recordPreflightBlocked(receipt, plan, inspection);
    },
    findUnresolvedPreflightBlock: () => {
      assertOpen();
      return journal().findUnresolvedPreflightBlock();
    },
    renew: () => {
      assertOpen();
      lease = context.leases.renew(lease, Date.parse(context.now()), 300_000);
    },
    commit: (effect) => {
      assertOpen();
      return context.leases.commit(lease, Date.parse(context.now()), effect);
    },
    managedInvocation: (plan, effect, authorityDigest) => {
      assertOpen();
      return {
        plan: structuredClone(plan),
        effect: structuredClone(effect),
        authorityDigest,
        ownerLease: structuredClone(lease),
      };
    },
  };
  return {
    session,
    close: () => {
      open = false;
      context.leases.release(lease);
    },
  };
}
