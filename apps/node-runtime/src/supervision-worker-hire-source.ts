import { repositoryPathWithinScope } from "@lervo/work-controller";
import type { OperatingActionPlanV1, SupervisedWorkerHireV1 } from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { resolveRoleContract } from "@lervo/roles";
import { workforceLimits } from "@lervo/agent-workforce";
import { operatingContractHash, supervisedWorkerHireFields } from "@lervo/work-controller";
import type { SupervisionTaskSource } from "./supervision-task-source.js";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { observeSupervisionWorkforce } from "./supervision-workforce-source.js";

export async function readSupervisionHireEffect(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const effect = (await readSupervisionJsonArtifact(
    storage.artifacts,
    plan.effectHash,
  )) as SupervisedWorkerHireV1;
  const fields = supervisedWorkerHireFields(effect);
  if (
    Object.entries(fields).some(
      ([key, value]) =>
        operatingContractHash(value) !==
        operatingContractHash(plan[key as keyof OperatingActionPlanV1]),
    ) ||
    effect.requirement.executorAgentId !== plan.ownerAgentId ||
    effect.requirement.reviewerAgentId !== plan.ownerAgentId
  )
    throw new Error("The supervised hire differs from its exact requirement and parent.");
  const rationale = await readSupervisionJsonArtifact(
    storage.artifacts,
    effect.rationaleArtifactHash,
  );
  if (typeof rationale !== "string" || !rationale.trim())
    throw new Error("The hire rationale is unavailable.");
  return { effect, fields };
}

/** A canonical capacity or skill gap permits planning, never a fabricated absence of usable staff. */
export async function readCanonicalWorkerHire(input: {
  storage: ProjectStorage;
  source: Awaited<ReturnType<SupervisionTaskSource["read"]>>;
  plan: OperatingActionPlanV1;
  now(): string;
}) {
  const { storage, source, plan } = input;
  const basis = await readSupervisionHireEffect(storage, plan);
  const task = basis.effect.requirement;
  const parent = source.agents.find((item) => item.agentId === plan.ownerAgentId);
  const role = await resolveRoleContract(storage.paths.repositoryRoot, task.roleId);
  if (
    source.workstream.status !== "active" ||
    operatingContractHash(source.agents) !== basis.effect.expectedAgentsHash ||
    parent?.status !== "active" ||
    parent.delegationDepth >= workforceLimits.maximumDelegationDepth ||
    role.version !== task.roleVersion ||
    role.contractHash !== task.roleContractHash ||
    source.agents.some(
      (item) =>
        item.displayName.localeCompare(basis.effect.displayName, undefined, {
          sensitivity: "accent",
        }) === 0,
    ) ||
    task.expectedPaths.some(
      (path) => !parent.responsibilityPaths.some((scope) => repositoryPathWithinScope(path, scope)),
    ) ||
    Date.parse(input.now()) >= Date.parse(plan.deadline)
  )
    throw new Error("The supervised hire source, role, identity, or ancestry changed.");
  const workforce = await observeSupervisionWorkforce({
    repositoryRoot: storage.paths.repositoryRoot,
    projectId: plan.projectId,
    ownerAgentId: plan.ownerAgentId,
    provider: basis.effect.provider,
    responsibility: task,
    now: input.now,
  });
  if (
    workforce.candidates.some((item) => item.status === "available" || item.status === "unobserved")
  )
    throw new Error("Existing available or unobserved staff prevent absence-based hiring.");
  return { ...basis, role, parent, workforce };
}
