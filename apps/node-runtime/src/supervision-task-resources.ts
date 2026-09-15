import type { SupervisedAssignmentAmendmentV1 } from "@lervo/application-contract";
import { supervisedAssignmentAmendmentFields } from "@lervo/work-controller";
import { observedSupervisionRunTermination } from "./supervision-run-termination.js";
import { readProvenPreTurnFailure } from "./supervision-pre-turn-failure-source.js";
import type { SupervisedAssignmentRecovery } from "@lervo/application-contract";
import { supervisedAssignmentRecoveryFields } from "@lervo/work-controller";
import type {
  OperatingActionPlanV1,
  SupervisedArtifactReviewV1,
  AutomaticTopologyEffectV1,
  SupervisedGoalCompletionV1,
  SupervisedResultDelivery,
  SupervisedResponsibilityClaimV1,
  SupervisedOwnerReasoningV1,
  SupervisedWorkspacePreparationV1,
  SupervisedAssignmentCompletion,
  SupervisedWorkerHireV1,
} from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import type { ResourceAccountingDescriptor } from "@lervo/schemas";
import { comparableSupervisionResourceTotal } from "@lervo/work-controller";
import {
  readHistoricalOwnerDecision,
  readHistoricalManagedDecision,
} from "./supervision-control-decision.js";
import { readSupervisionHandoffArtifact } from "./supervision-handoff-artifact.js";
import { readSupervisionAttentionArtifact } from "./supervision-attention-artifact.js";
import {
  assertOperatingActionPlan,
  assertSupervisedArtifactReview,
  automaticTopologyEffectFields,
  managedExecutionIdentity,
  operatingContractHash,
  operatingDecisionId,
  supervisedArtifactReviewFields,
  assertSupervisedGoalCompletion,
  supervisedGoalCompletionFields,
  assertSupervisedResultDelivery,
  supervisedResultDeliveryFields,
  supervisedResponsibilityClaimFields,
  supervisedOwnerReasoningFields,
  supervisedWorkspacePreparationFields,
  supervisedAssignmentCompletionFields,
  supervisedWorkerHireFields,
} from "@lervo/work-controller";
import { readProvenAbandonedTurnFailure } from "./supervision-abandoned-turn-failure-source.js";
import { readSupervisionJsonArtifact as exactJson } from "./supervision-artifact-json.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";

/** Observed provider usage and outstanding exact reservations; internal controls start no provider. */
export async function observeSupervisionTaskResources(input: {
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  artifacts: ArtifactStore;
  events: EventStore;
  plan: OperatingActionPlanV1;
}) {
  const { source, artifacts, plan } = input;
  // Reporting groups remain exact; a separate proof can resolve default model identity.
  const groups = source.workstreamResources.groups;
  const workRuns = new Set(source.workstreamResources.runIds);
  const preTurnFailures = new Set<string>();
  for (const runId of workRuns)
    if (
      await readProvenPreTurnFailure(
        source.events.filter((event) => event.runId === runId),
        artifacts,
      )
    )
      preTurnFailures.add(runId);
  // A proven abandoned turn is settled but did start a session, so it stays charged as reserved
  // spend and only leaves the observation population, which can never gain its usage receipt.
  const abandonedFailures = new Set<string>();
  for (const runId of workRuns)
    if (
      await readProvenAbandonedTurnFailure(
        source.events.filter((event) => event.runId === runId),
        artifacts,
      )
    )
      abandonedFailures.add(runId);
  const accountedRunIds = [...workRuns].filter(
    (runId) => !preTurnFailures.has(runId) && !abandonedFailures.has(runId),
  );
  const allStartedObserved = source.events
    .filter(
      (event) =>
        event.type === "adapter.started" &&
        workRuns.has(event.runId) &&
        !abandonedFailures.has(event.runId),
    )
    .every((event) =>
      source.events.some(
        (usage) =>
          usage.runId === event.runId &&
          usage.type === "resource.usage.recorded" &&
          usage.payload.source === "provider_reported" &&
          usage.payload.status === "observed",
      ),
    );
  const exactUsage =
    allStartedObserved &&
    groups.length === 1 &&
    groups[0]!.completeness === "complete" &&
    groups[0]!.source === "provider_reported" &&
    groups[0]!.runCount === accountedRunIds.length;
  const descriptors = new Map<string, ResourceAccountingDescriptor>();
  if (allStartedObserved && groups.length === 2)
    for (const group of groups)
      descriptors.set(
        group.accountingDescriptorHash,
        (await exactJson(
          artifacts,
          group.accountingDescriptorHash,
        )) as ResourceAccountingDescriptor,
      );
  const comparableTotal =
    allStartedObserved && groups.length === 2
      ? comparableSupervisionResourceTotal({
          runIds: accountedRunIds,
          groups,
          events: source.events,
          descriptors,
        })
      : null;
  const zeroOnly = accountedRunIds.length === 0 && groups.length === 0;
  const completeUsage = zeroOnly || exactUsage || comparableTotal !== null;
  let observedAggregateTokens = zeroOnly
    ? 0
    : exactUsage
      ? groups[0]!.totalTokens
      : comparableTotal;
  let reservedAggregateTokens: number | null = 0;
  const reservedRuns = new Set<string>();
  const currentDecision = operatingDecisionId(plan);
  const scopeSequence =
    source.scopeAnchor === undefined
      ? 0
      : source.events.find((event) => event.eventId === source.scopeAnchor!.eventId)!.seq;
  for (const event of source.events.filter(
    (item) =>
      item.type === "work.supervision.decision.recorded" &&
      item.seq > scopeSequence &&
      item.payload.workstreamId === plan.workstreamId,
  )) {
    const recorded = (await exactJson(
      artifacts,
      String(event.payload.planArtifactHash),
    )) as OperatingActionPlanV1;
    assertOperatingActionPlan(recorded);
    if (
      operatingContractHash(recorded) !== event.payload.planHash ||
      recorded.projectId !== plan.projectId ||
      recorded.supervisionId !== event.payload.supervisionId ||
      recorded.ownerAgentId !== event.payload.ownerAgentId ||
      recorded.workstreamId !== plan.workstreamId ||
      operatingDecisionId(recorded) !== event.payload.decisionId
    )
      throw new Error("The task reservation differs from its recorded decision.");
    if (
      [
        "work.scoped_handoff.v1",
        "work.owner_attention.v1",
        "work.scoped_handoff_acceptance.v1",
        "work.assignment_amendment.v1",
        "work.assignment_recovery.v1",
        "work.assignment_recovery.v2",
        "work.workspace_preparation.v1",
        "work.assignment_completion.v1",
        "work.assignment_completion.v2",
        "work.assignment_completion.v3",
        "work.worker_hire.v1",
        "work.artifact_review.v1",
        "work.goal_completion.v1",
        "work.result_delivery.v1",
        "work.result_delivery.v2",
        "assignment.topology.materialize.v1",
        "work.responsibility_claim.v1",
      ].includes(recorded.effectContract)
    ) {
      const effect = await exactJson(artifacts, recorded.effectHash);
      if (recorded.effectContract === "work.artifact_review.v1")
        assertSupervisedArtifactReview(effect as SupervisedArtifactReviewV1, recorded);
      if (recorded.effectContract === "work.goal_completion.v1")
        assertSupervisedGoalCompletion(effect as SupervisedGoalCompletionV1, recorded);
      if (["work.result_delivery.v1", "work.result_delivery.v2"].includes(recorded.effectContract))
        assertSupervisedResultDelivery(effect as SupervisedResultDelivery, recorded);
      const fields =
        recorded.effectContract === "work.owner_attention.v1"
          ? (await readSupervisionAttentionArtifact(artifacts, recorded)).fields
          : ["work.scoped_handoff.v1", "work.scoped_handoff_acceptance.v1"].includes(
                recorded.effectContract,
              )
            ? (await readSupervisionHandoffArtifact(artifacts, recorded)).fields
            : recorded.effectContract === "work.assignment_amendment.v1"
              ? supervisedAssignmentAmendmentFields(effect as SupervisedAssignmentAmendmentV1)
              : ["work.assignment_recovery.v1", "work.assignment_recovery.v2"].includes(
                    recorded.effectContract,
                  )
                ? supervisedAssignmentRecoveryFields(effect as SupervisedAssignmentRecovery)
                : recorded.effectContract === "work.worker_hire.v1"
                  ? supervisedWorkerHireFields(effect as SupervisedWorkerHireV1)
                  : [
                        "work.assignment_completion.v1",
                        "work.assignment_completion.v2",
                        "work.assignment_completion.v3",
                      ].includes(recorded.effectContract)
                    ? supervisedAssignmentCompletionFields(effect as SupervisedAssignmentCompletion)
                    : recorded.effectContract === "work.workspace_preparation.v1"
                      ? supervisedWorkspacePreparationFields(
                          effect as SupervisedWorkspacePreparationV1,
                        )
                      : recorded.effectContract === "work.artifact_review.v1"
                        ? supervisedArtifactReviewFields(effect as SupervisedArtifactReviewV1)
                        : recorded.effectContract === "work.goal_completion.v1"
                          ? supervisedGoalCompletionFields(effect as SupervisedGoalCompletionV1)
                          : ["work.result_delivery.v1", "work.result_delivery.v2"].includes(
                                recorded.effectContract,
                              )
                            ? supervisedResultDeliveryFields(effect as SupervisedResultDelivery)
                            : recorded.effectContract === "work.responsibility_claim.v1"
                              ? supervisedResponsibilityClaimFields(
                                  effect as SupervisedResponsibilityClaimV1,
                                )
                              : automaticTopologyEffectFields(effect as AutomaticTopologyEffectV1);
      if (
        Object.entries(fields).some(
          ([key, value]) =>
            operatingContractHash(value) !==
            operatingContractHash(recorded[key as keyof OperatingActionPlanV1]),
        )
      )
        throw new Error("The internal reservation differs from its exact non-provider effect.");
      const confirmed = source.events.some(
        (item) =>
          item.type === "work.supervision.effect.observed" &&
          item.payload.decisionId === event.payload.decisionId &&
          item.payload.planHash === event.payload.planHash &&
          item.payload.status === "effect_confirmed" &&
          item.seq > event.seq,
      );
      if (!confirmed && event.payload.decisionId !== currentDecision)
        reservedAggregateTokens =
          reservedAggregateTokens === null
            ? null
            : reservedAggregateTokens + recorded.reservedTokens;
      continue;
    }
    if (
      ![
        "work.managed_execution.v1",
        "work.managed_execution.v2",
        "work.owner_reasoning.v1",
      ].includes(recorded.effectContract)
    ) {
      reservedAggregateTokens = null;
      continue;
    }
    if (recorded.effectContract === "work.owner_reasoning.v1") {
      if (
        (await readHistoricalOwnerDecision({ artifacts, events: input.events }, recorded))
          .superseded
      )
        continue;
      const fields = supervisedOwnerReasoningFields(
        (await exactJson(artifacts, recorded.effectHash)) as SupervisedOwnerReasoningV1,
      );
      if (
        Object.entries(fields).some(
          ([key, value]) =>
            operatingContractHash(value) !==
            operatingContractHash(recorded[key as keyof OperatingActionPlanV1]),
        )
      )
        throw new Error("The owner reasoning reservation differs from its exact provider effect.");
    } else if (
      (await readHistoricalManagedDecision({ artifacts, events: input.events }, recorded))
        .superseded
    )
      continue;
    const identity = managedExecutionIdentity(plan.projectId, operatingContractHash(recorded));
    const run = source.events.filter((item) => item.runId === identity.runId);
    const abandoned = abandonedFailures.has(identity.runId);
    const finished =
      preTurnFailures.has(identity.runId) ||
      abandoned ||
      observedSupervisionRunTermination(run) !== null;
    if (!finished) reservedRuns.add(identity.runId);
    if (event.payload.decisionId !== currentDecision) {
      // An abandoned turn keeps its reservation charged; treating it as zero would erase spend.
      if (abandoned)
        reservedAggregateTokens =
          reservedAggregateTokens === null
            ? null
            : reservedAggregateTokens + recorded.reservedTokens;
      else if (!finished || !completeUsage) {
        observedAggregateTokens = null;
        reservedAggregateTokens =
          reservedAggregateTokens === null
            ? null
            : reservedAggregateTokens + recorded.reservedTokens;
      }
    }
  }
  const activeRuns = new Set(
    source.execution.attempts
      .filter((item) => item.terminalStatus === "in_progress")
      .map((item) => item.runId),
  );
  for (const run of reservedRuns) activeRuns.add(run);
  for (const run of workRuns)
    if (
      !source.events.some(
        (event) => event.runId === run && ["run.completed", "run.failed"].includes(event.type),
      )
    )
      activeRuns.add(run);
  activeRuns.delete(managedExecutionIdentity(plan.projectId, operatingContractHash(plan)).runId);
  const usageKnown = observedAggregateTokens !== null && reservedAggregateTokens !== null;
  return {
    observedAggregateTokens,
    reservedAggregateTokens,
    activeAttempts: activeRuns.size,
    resourceAdmission: usageKnown ? ("within" as const) : ("unobserved" as const),
  };
}
