import type { AutomaticTopologyEffectV1, OperatingActionPlanV1 } from "@lervo/application-contract";
import { listAssignments, topologyAssignmentObservation } from "@lervo/agent-workforce";
import { resolveRoleContract } from "@lervo/roles";
import {
  automaticTopologyEffectFields,
  createAssignmentTopologyPlan,
  operatingContractHash,
} from "@lervo/work-controller";
import type { ArtifactStore } from "@lervo/storage-contract";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { observeSupervisionWorkforce } from "./supervision-workforce-source.js";

/** Binds structural allocation to actual roles, available staff and canonical graph bytes. */
export async function readCanonicalSupervisionTopology(input: {
  repositoryRoot: string;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  artifacts: ArtifactStore;
  plan: OperatingActionPlanV1;
  now(): string;
}) {
  const { source, plan } = input;
  const effect = (await readSupervisionJsonArtifact(
    input.artifacts,
    plan.effectHash,
  )) as AutomaticTopologyEffectV1;
  const fields = automaticTopologyEffectFields(effect);
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    ) ||
    source.workstream.status !== "active" ||
    source.workstream.workstreamId !== plan.workstreamId ||
    source.graph.graphHash !== plan.graphHash ||
    effect.responsibility.reviewerAgentId !== plan.ownerAgentId ||
    !["codex", "claude"].includes(effect.provider)
  )
    throw new Error("The canonical topology differs from its exact operating scope.");
  const assignments = await listAssignments(input.repositoryRoot);
  if (
    operatingContractHash(assignments.filter((item) => item.workstreamId === plan.workstreamId)) !==
    operatingContractHash(source.workstreamAssignments)
  )
    throw new Error("The topology assignment source changed.");
  const role = await resolveRoleContract(input.repositoryRoot, fields.roleId);
  const topology = createAssignmentTopologyPlan({
    projectId: plan.projectId,
    currentWorkstreamId: source.workstream.workstreamId,
    currentGraphHash: source.graph.graphHash,
    graphValid: source.graph.validity.status === "valid",
    request: effect.request,
    roleContracts: [
      { roleId: role.roleId, roleVersion: role.version, roleContractHash: role.contractHash },
    ],
    assignments: assignments.map(topologyAssignmentObservation),
    maximumAssignments: 256,
  });
  if (operatingContractHash(topology) !== operatingContractHash(effect.topology))
    throw new Error("The proposed topology is not the current canonical structural plan.");
  const workforce = await observeSupervisionWorkforce({
    repositoryRoot: input.repositoryRoot,
    projectId: plan.projectId,
    ownerAgentId: plan.ownerAgentId,
    provider: effect.provider as "codex" | "claude",
    responsibility: effect.responsibility,
    now: input.now,
  });
  if (
    workforce.assignmentSourceHash !== operatingContractHash(assignments) ||
    workforce.agentSourceHash !== operatingContractHash(source.agents) ||
    workforce.candidates.find((item) => item.agentId === effect.responsibility.executorAgentId)
      ?.status !== "available"
  )
    throw new Error("The proposed topology executor is unavailable or outside its authority.");
  const rationale = await readSupervisionJsonArtifact(input.artifacts, plan.rationaleArtifactHash);
  if (typeof rationale !== "string" || rationale.trim().length === 0)
    throw new Error("The topology allocation rationale is unavailable.");
  return { effect, fields, topology, assignments, workforce };
}
