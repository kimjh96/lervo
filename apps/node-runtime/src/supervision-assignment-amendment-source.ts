import type {
  OperatingActionPlanV1,
  OperatingMandate,
  SupervisedAssignmentAmendmentV1,
} from "@lervo/application-contract";
import {
  amendedAssignment,
  listWorkspaces,
  type WorkforceAssignment,
} from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  evaluateResponsibilityClaim,
  operatingContractHash,
  supervisedAssignmentAmendmentFields,
} from "@lervo/work-controller";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { observeSupervisionWorkforce } from "./supervision-workforce-source.js";
import { observeUnstartedSupervisionWorkspace } from "./supervision-unstarted-workspace.js";

export async function readAssignmentAmendmentEffect(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const effect = (await readSupervisionJsonArtifact(
    storage.artifacts,
    plan.effectHash,
  )) as SupervisedAssignmentAmendmentV1;
  const fields = supervisedAssignmentAmendmentFields(effect);
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    )
  )
    throw new Error("The amendment differs from its exact admitted fields.");
  const previous = (await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.expectedAssignmentHash,
  )) as WorkforceAssignment;
  const rationale = await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.rationaleArtifactHash,
  );
  if (typeof rationale !== "string" || rationale.trim().length === 0)
    throw new Error("The amendment rationale is unavailable.");
  return { effect, fields, previous };
}

export async function readCanonicalAssignmentAmendment(input: {
  storage: ProjectStorage;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  plan: OperatingActionPlanV1;
  mandate: OperatingMandate;
  now(): string;
}) {
  const { storage, source, plan, mandate } = input;
  const basis = await readAssignmentAmendmentEffect(storage, plan);
  const { effect, previous } = basis;
  const assignment = source.assignments.find((item) => item.assignmentId === previous.assignmentId);
  const binding = source.responsibilities.find(
    (item) => item.assignmentId === previous.assignmentId,
  )?.binding;
  const next = amendedAssignment(previous, effect, input.now());
  // A retired checkout was proven unused before removal and holds no execution authority.
  const workspaces = (await listWorkspaces(storage.paths.repositoryRoot)).filter(
    (item) => item.assignmentId === previous.assignmentId && item.state !== "removed",
  );
  // An unstarted checkout with positive proof is retained, as for a plain revision; a started
  // or unproven one still blocks the amendment.
  const unstartedProofs = await Promise.all(
    workspaces.map((workspace) =>
      assignment === undefined
        ? null
        : observeUnstartedSupervisionWorkspace({
            repositoryRoot: storage.paths.repositoryRoot,
            binding: {
              supervisionId: plan.supervisionId,
              workstreamId: plan.workstreamId,
              ownerAgentId: plan.ownerAgentId,
              mandateHash: plan.mandateHash,
            },
            assignment,
            workspace,
            now: input.now,
            storage,
          }),
    ),
  );
  if (
    source.workstream.status !== "active" ||
    source.graph.validity.status !== "valid" ||
    source.graph.graphHash !== plan.graphHash ||
    assignment === undefined ||
    operatingContractHash(assignment) !== effect.expectedAssignmentHash ||
    binding?.responsibilityHash !== effect.predecessorBindingHash ||
    effect.responsibility.reviewerAgentId !== plan.ownerAgentId ||
    source.execution.attempts.some((item) => item.assignmentId === previous.assignmentId) ||
    unstartedProofs.some((proof) => proof === null) ||
    evaluateResponsibilityClaim({
      source: { ...next, liveLease: false, predecessorBindingHash: effect.predecessorBindingHash },
      responsibility: effect.responsibility,
      maximumDeadlineMs: mandate.maximumDeadlineMs,
      now: input.now(),
    }).status !== "ready"
  )
    throw new Error(
      "The amendment must preserve an unstarted assignment whose checkouts are proven unstarted and current owner authority.",
    );
  const workforce = await observeSupervisionWorkforce({
    repositoryRoot: storage.paths.repositoryRoot,
    projectId: plan.projectId,
    ownerAgentId: plan.ownerAgentId,
    provider: effect.provider,
    responsibility: effect.responsibility,
    now: input.now,
  });
  if (
    workforce.candidates.find((item) => item.agentId === effect.responsibility.executorAgentId)
      ?.status !== "available"
  )
    throw new Error("The amendment executor has no current scoped capacity.");
  return { ...basis, assignment, workspaces };
}
