import type { OperatingActionPlanV1 } from "@lervo/application-contract";
import { listAgents } from "@lervo/agent-workforce";
import { workforceProviderPolicyHash } from "@lervo/agent-organization";
import type { ProjectStorage } from "@lervo/project-storage";
import { operatingContractHash } from "@lervo/work-controller";
import { readAdmittedControlDecision } from "./supervision-control-decision.js";
import { readSupervisionHireEffect } from "./supervision-worker-hire-source.js";

export async function supervisionHireReceiptBasis(
  storage: ProjectStorage,
  plan: OperatingActionPlanV1,
) {
  const admitted = await readAdmittedControlDecision(storage, plan);
  const basis = await readSupervisionHireEffect(storage, plan);
  const eventId = (type: string) =>
    `evt_${operatingContractHash({ runId: admitted.runId, type, identity: admitted.identity }).slice(7, 39)}`;
  return {
    ...basis,
    ...admitted,
    registeredEventId: eventId("agent.registered"),
    membershipEventId: eventId("organization.agent.membership.changed"),
  };
}

export async function inspectSupervisionHire(storage: ProjectStorage, plan: OperatingActionPlanV1) {
  const basis = await supervisionHireReceiptBasis(storage, plan);
  const event = storage.events.get(basis.registeredEventId);
  const membership = storage.events.get(basis.membershipEventId);
  const agents = await listAgents(storage.paths.repositoryRoot);
  if (event === null && membership === null)
    return {
      status:
        operatingContractHash(agents) === basis.effect.expectedAgentsHash
          ? ("not_started" as const)
          : ("uncertain" as const),
    };
  const agent = agents.find((item) => item.agentId === event?.payload.agentId);
  const task = basis.effect.requirement;
  if (
    event?.type !== "agent.registered" ||
    event.schemaVersion !== 3 ||
    event.actor.kind !== "system" ||
    event.runId !== basis.runId ||
    event.seq <= basis.decision.seq ||
    event.payload.parentAgentId !== plan.ownerAgentId ||
    event.payload.displayName !== basis.effect.displayName ||
    event.payload.provider !== basis.effect.provider ||
    event.payload.roleId !== task.roleId ||
    event.payload.roleVersion !== task.roleVersion ||
    event.payload.roleContractHash !== task.roleContractHash ||
    agent === undefined ||
    agent.parentAgentId !== plan.ownerAgentId ||
    agent.roleId !== task.roleId ||
    agent.roleContractHash !== task.roleContractHash ||
    agent.createdAt !== event.occurredAt ||
    operatingContractHash(agent.responsibilityPaths) !==
      operatingContractHash([...new Set(task.expectedPaths)].sort()) ||
    membership?.type !== "organization.agent.membership.changed" ||
    membership.schemaVersion !== 3 ||
    membership.actor.kind !== "system" ||
    membership.runId !== basis.runId ||
    membership.seq !== event.seq + 1 ||
    membership.payload.agentId !== agent.agentId ||
    membership.payload.teamId !== plan.teamId ||
    membership.payload.roleContractHash !== task.roleContractHash ||
    membership.payload.roleProfileHash !== agent.roleProfileHash ||
    membership.payload.providerPolicyHash !== workforceProviderPolicyHash(basis.effect.provider) ||
    membership.payload.status !== "active" ||
    membership.payload.previousStatus !== null ||
    membership.payload.revision !== 1
  )
    return { status: "uncertain" as const };
  return { status: "confirmed" as const, eventIds: [event.eventId, membership.eventId] };
}
