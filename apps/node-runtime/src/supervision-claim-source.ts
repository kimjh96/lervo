import { observeUnstartedSupervisionWorkspace } from "./supervision-unstarted-workspace.js";
import { listWorkspaces } from "@lervo/agent-workforce";
import type {
  OperatingActionPlanV1,
  OperatingMandate,
  SupervisedResponsibilityClaimV1,
} from "@lervo/application-contract";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  evaluateResponsibilityClaim,
  operatingContractHash,
  supervisedResponsibilityClaimFields,
} from "@lervo/work-controller";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { observeSupervisionWorkforce } from "./supervision-workforce-source.js";

/** A retired checkout was proven unused before removal and holds no execution authority. */
export async function listClaimWorkspaces(repositoryRoot: string, assignmentId: string) {
  return (await listWorkspaces(repositoryRoot)).filter(
    (item) => item.assignmentId === assignmentId && item.state !== "removed",
  );
}

/** Observes the exact unleased predecessor and qualified executor before responsibility acquisition. */
export async function readCanonicalSupervisionClaim(input: {
  storage: ProjectStorage;
  repositoryRoot: string;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  artifacts: ArtifactStore;
  plan: OperatingActionPlanV1;
  mandate: OperatingMandate;
  now(): string;
}) {
  const { plan, source, mandate } = input;
  const effect = (await readSupervisionJsonArtifact(
    input.artifacts,
    plan.effectHash,
  )) as SupervisedResponsibilityClaimV1;
  const fields = supervisedResponsibilityClaimFields(effect);
  const task = effect.responsibility;
  const assignment = source.assignments.find((item) => item.assignmentId === task.assignmentId);
  const predecessor = source.responsibilities.find(
    (item) => item.assignmentId === task.assignmentId,
  )?.binding;
  const now = input.now();
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    ) ||
    source.workstream.status !== "active" ||
    source.workstream.workstreamId !== plan.workstreamId ||
    source.graph.graphHash !== plan.graphHash ||
    source.graph.validity.status !== "valid" ||
    assignment === undefined ||
    operatingContractHash(assignment) !== effect.expectedAssignmentHash ||
    task.reviewerAgentId !== plan.ownerAgentId ||
    (assignment.status === "queued" &&
      assignment.recovery === undefined &&
      assignment.amendment !== undefined &&
      operatingContractHash(task) !== assignment.amendment.successorResponsibilityHash) ||
    Date.parse(now) + effect.leaseDurationMs >
      Math.min(Date.parse(task.completionDeadline), Date.parse(mandate.expiresAt)) ||
    evaluateResponsibilityClaim({
      source: {
        ...assignment,
        liveLease:
          assignment.lease !== null && Date.parse(assignment.lease.expiresAt) > Date.parse(now),
        predecessorBindingHash: predecessor?.responsibilityHash ?? null,
      },
      responsibility: task,
      maximumDeadlineMs: mandate.maximumDeadlineMs,
      now,
    }).status !== "ready"
  )
    throw new Error(
      "The canonical responsibility claim is stale, leased or outside its exact scope.",
    );
  const workspaces = await listClaimWorkspaces(input.repositoryRoot, assignment.assignmentId);
  if (predecessor !== null && predecessor !== undefined && assignment.recovery === undefined) {
    if (
      source.execution.attempts.some((item) => item.assignmentId === assignment.assignmentId) ||
      (
        await Promise.all(
          workspaces.map((workspace) =>
            observeUnstartedSupervisionWorkspace({
              storage: input.storage,
              repositoryRoot: input.repositoryRoot,
              binding: plan,
              assignment,
              workspace,
              now: input.now,
            }),
          ),
        )
      ).some((proof) => proof === null)
    )
      throw new Error(
        "Responsibility revision must first reconcile the previous execution or workspace.",
      );
  }
  const workforce = await observeSupervisionWorkforce({
    repositoryRoot: input.repositoryRoot,
    projectId: plan.projectId,
    ownerAgentId: plan.ownerAgentId,
    provider: effect.provider,
    responsibility: task,
    now: input.now,
  });
  if (
    workforce.candidates.find((item) => item.agentId === task.executorAgentId)?.status !==
    "available"
  )
    throw new Error("The responsibility executor has conflicting authority or a live lease.");
  const rationale = await readSupervisionJsonArtifact(
    input.artifacts,
    effect.rationaleArtifactHash,
  );
  if (typeof rationale !== "string" || rationale.trim().length === 0)
    throw new Error("The responsibility claim rationale is unavailable.");
  return { effect, fields, assignment, workforce, workspaces };
}
