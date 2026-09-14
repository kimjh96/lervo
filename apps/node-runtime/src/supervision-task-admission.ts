import { readCanonicalAssignmentAmendment } from "./supervision-assignment-amendment-source.js";
import { readCanonicalSupervisionAttention } from "./supervision-attention-source.js";
import { readCanonicalAssignmentRecovery } from "./supervision-assignment-recovery-source.js";
import { readCanonicalWorkerHire } from "./supervision-worker-hire-source.js";
import { readCanonicalAssignmentCompletion } from "./supervision-assignment-completion-source.js";
import { readCanonicalWorkspacePreparation } from "./supervision-workspace-plan.js";
import type {
  OperatingActionPlanV1,
  OperatingAdmissionSnapshotV1,
} from "@lervo/application-contract";
import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import {
  assertOperatingActionPlan,
  operatingContractHash,
  operatingEffectAdmissionHash,
  supervisedManagedExecutionFields,
  operatingReadinessKind,
} from "@lervo/work-controller";
import { readSupervisionJsonArtifact as exactJson } from "./supervision-artifact-json.js";
import type { SupervisedManagedExecution } from "@lervo/application-contract";
import type { observeNodeSupervisionAuthority } from "./supervision-authority.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";

import { observeSupervisionTaskResources } from "./supervision-task-resources.js";
import { readSupervisionOwnerControl } from "./supervision-owner-control.js";
import type { NodeSupervisionBinding } from "./supervision-authority.js";
import { readCanonicalSupervisionTopology } from "./supervision-topology-source.js";
import { readCanonicalSupervisionClaim } from "./supervision-claim-source.js";
import { readCanonicalOwnerReasoning } from "./supervision-reasoning-source.js";
import type { ProjectStorage } from "@lervo/project-storage";
import { hasSupervisionRecoveryAncestor } from "./supervision-recovery-lineage.js";

type Source = Awaited<ReturnType<SupervisionTaskSource["read"]>>;

/** Observes one exact managed effect against canonical task, reservation and usage evidence. */
export async function observeSupervisionTaskAdmission(input: {
  storage: ProjectStorage;
  repositoryRoot: string;
  source: Source;
  authority: Awaited<ReturnType<typeof observeNodeSupervisionAuthority>>;
  artifacts: ArtifactStore;
  events: EventStore;
  binding: NodeSupervisionBinding;
  plan: OperatingActionPlanV1;
  now: string;
}): Promise<OperatingAdmissionSnapshotV1> {
  const { source, authority, artifacts, plan, now } = input;
  assertOperatingActionPlan(plan);
  let fields: Partial<OperatingActionPlanV1>;
  let liveResponsibilityLease = false;
  if (plan.effectContract === "work.owner_attention.v1") {
    fields = (await readCanonicalSupervisionAttention({ ...input, now: () => now })).fields;
  } else if (plan.effectContract === "work.assignment_amendment.v1") {
    fields = (
      await readCanonicalAssignmentAmendment({
        ...input,
        mandate: authority.installation.mandate,
        now: () => now,
      })
    ).fields;
  } else if (
    ["work.assignment_recovery.v1", "work.assignment_recovery.v2"].includes(plan.effectContract)
  ) {
    fields = (
      await readCanonicalAssignmentRecovery({
        ...input,
        mandate: authority.installation.mandate,
        now: () => now,
      })
    ).fields;
  } else if (plan.effectContract === "work.worker_hire.v1") {
    fields = (await readCanonicalWorkerHire({ ...input, now: () => now })).fields;
  } else if (
    [
      "work.assignment_completion.v1",
      "work.assignment_completion.v2",
      "work.assignment_completion.v3",
    ].includes(plan.effectContract)
  ) {
    fields = (await readCanonicalAssignmentCompletion({ ...input, now: () => now })).fields;
  } else if (plan.effectContract === "work.workspace_preparation.v1") {
    fields = (await readCanonicalWorkspacePreparation({ ...input, now: () => now })).fields;
  } else if (plan.effectContract === "work.owner_reasoning.v1") {
    fields = (await readCanonicalOwnerReasoning({ ...input, now: () => now })).fields;
  } else if (plan.effectContract === "work.responsibility_claim.v1") {
    fields = (
      await readCanonicalSupervisionClaim({
        ...input,
        mandate: authority.installation.mandate,
        now: () => now,
      })
    ).fields;
  } else if (plan.effectContract === "assignment.topology.materialize.v1") {
    fields = (await readCanonicalSupervisionTopology({ ...input, now: () => now })).fields;
  } else if (operatingReadinessKind(plan) === "owner_control") {
    fields = (await readSupervisionOwnerControl({ ...input, source, plan })).fields;
  } else {
    const effect = (await exactJson(artifacts, plan.effectHash)) as SupervisedManagedExecution;
    fields = supervisedManagedExecutionFields(effect);
    if (
      Object.entries(fields).some(
        ([key, value]) =>
          operatingContractHash(value) !==
          operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
      )
    )
      throw new Error("The task admission differs from its exact effect.");
    const task = effect.responsibility;
    const assignment = source.assignments.find((item) => item.assignmentId === task.assignmentId);
    const currentBinding = source.responsibilities.find(
      (item) => item.assignmentId === task.assignmentId,
    )?.binding;
    if (
      source.workstream.workstreamId !== plan.workstreamId ||
      source.workstream.revision !== authority.source.workstreamRevision ||
      assignment?.revision !== task.assignmentRevision ||
      assignment.assigneeAgentId !== task.executorAgentId ||
      assignment.lease?.leaseId !== effect.leaseId ||
      currentBinding?.responsibilityHash !== fields.responsibilityArtifactHash ||
      (effect.schemaVersion === 2 &&
        (operatingContractHash(assignment.recovery ?? null) !==
          operatingContractHash(effect.recovery) ||
          !hasSupervisionRecoveryAncestor({
            events: source.events,
            supervisionId: input.binding.supervisionId,
            workstreamId: input.binding.workstreamId,
            assignmentId: task.assignmentId,
            currentBindingEventId: currentBinding?.eventId ?? "",
            recoveryResponsibilityHash: effect.recovery.responsibilityHash,
          })))
    )
      throw new Error("The task admission responsibility changed.");

    liveResponsibilityLease =
      assignment.lease !== null && Date.parse(assignment.lease.expiresAt) > Date.parse(now);
  }
  const resources = await observeSupervisionTaskResources({
    source,
    artifacts,
    plan,
    events: input.events,
  });
  return {
    observedAt: now,
    sourceRevisionDigest: source.sourceRevisionDigest,
    graphHash: source.graph.graphHash,
    installedMandateHash: authority.installation.mandateHash,
    installationReviewHash: authority.installation.installationReviewHash,
    revocationCoordinate: authority.installation.mandate.revocationCoordinate,
    revoked: authority.installation.revoked,
    ancestryValid: authority.source.eligible,
    historyValid: source.graph.validity.status === "valid",
    activeWorkers: source.agents.filter((agent) => agent.status === "active").length,
    activeAttempts: resources.activeAttempts,
    assignmentCount: source.assignments.length,
    observedAggregateTokens: resources.observedAggregateTokens,
    reservedAggregateTokens: resources.reservedAggregateTokens,
    liveResponsibilityLease,
    resourceAdmission: resources.resourceAdmission,
    effectAdmissionHash: operatingEffectAdmissionHash({ ...plan, ...fields }),
    effectMappings: [{ actionKind: fields.actionKind!, contract: fields.effectContract! }],
  };
}
