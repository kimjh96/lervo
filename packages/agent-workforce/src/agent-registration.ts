import {
  type AgentOrigin,
  type WorkforceProvider,
  type WorkforceEventRecorder,
  type WorkforceAgent,
} from "./types.js";
import { registry } from "./agent-registry.js";
import { resolveRoleContract } from "@lervo/roles";
import { fail, boundedStrings, safePath, id } from "./workforce-state-validation.js";
import { workforceLimits } from "./limits.js";
import { resolveAgentCapabilityBinding } from "./agent-capability-binding.js";
import { randomUUID } from "node:crypto";
import {
  validAgentDisplayName,
  generateAgentDisplayName,
  withAgentDisplayIdentity,
} from "./agent-display-identity.js";
import { transition, retryConcurrent } from "./workforce-state-io.js";

export async function registerAgentOnce(input: {
  repositoryRoot: string;
  roleId: string;
  provider?: WorkforceProvider;
  responsibilityPaths?: string[];
  skillIds?: string[];
  capabilityPackageIds?: string[];
  parentAgentId?: string;
  displayName?: string;
  /** The team's or Lervo's own (ADR-0643); a caller that hires for a Lervo service says `lervo`. */
  origin?: AgentOrigin;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAgent> {
  const now = input.now ?? new Date();
  const current = await registry(input.repositoryRoot);
  const contract = await resolveRoleContract(input.repositoryRoot, input.roleId);
  const definition = contract.definition;
  const parent =
    input.parentAgentId === undefined
      ? null
      : (current.value.agents.find((agent) => agent.agentId === input.parentAgentId) ?? null);
  if (input.parentAgentId !== undefined && (parent === null || parent.status !== "active"))
    fail("agent_state_conflict", "A subagent requires an active parent agent.");
  const delegationDepth = parent === null ? 0 : parent.delegationDepth + 1;
  if (delegationDepth > workforceLimits.maximumDelegationDepth)
    fail("agent_state_conflict", "The maximum subagent delegation depth was reached.");
  const responsibilityPaths = [...new Set(input.responsibilityPaths ?? ["*"])].sort();
  const skillIds = [...new Set(input.skillIds ?? definition.profile.defaultSkills)].sort();
  const capabilityPackageIds = [
    ...new Set(
      input.capabilityPackageIds ??
        parent?.capabilityPackages?.map((item) => item.capabilityId) ??
        definition.profile.defaultCapabilityPackages ??
        [],
    ),
  ].sort();
  if (
    parent !== null &&
    capabilityPackageIds.some(
      (id) => !parent.capabilityPackages?.some((item) => item.capabilityId === id),
    )
  )
    fail(
      "agent_state_conflict",
      "A subagent cannot expand its parent's capability package authority.",
    );
  if (
    !boundedStrings(responsibilityPaths, 64) ||
    !responsibilityPaths.every(safePath) ||
    !boundedStrings(skillIds, 32)
  )
    fail("agent_invalid", "Agent skills or responsibility paths are invalid.");
  const capabilityBinding = await resolveAgentCapabilityBinding({
    repositoryRoot: input.repositoryRoot,
    projectId: current.projectId,
    provider: input.provider ?? "any",
    contract,
    capabilityPackageIds,
    generatedAt: now.toISOString(),
  });
  // ADR-0643: Lervo's own agents never take the team's places, and the team's never take Lervo's.
  const lervo = input.origin === "lervo";
  const sameOrigin = current.value.agents.filter(
    (agent) => (agent.origin === "lervo") === lervo,
  ).length;
  if (sameOrigin >= (lervo ? workforceLimits.maximumLervoAgents : workforceLimits.maximumAgents))
    fail("agent_state_conflict", "The repository agent limit was reached.");
  const createdAt = now.toISOString();
  const agentId = id("agt", { projectId: current.projectId, nonce: randomUUID() });
  if (input.displayName !== undefined && !validAgentDisplayName(input.displayName)) {
    fail("agent_invalid", "The agent display name is invalid.");
  }
  const displayName = input.displayName ?? generateAgentDisplayName(agentId);
  if (
    current.value.agents.some(
      (existing) =>
        withAgentDisplayIdentity(existing).displayName.localeCompare(displayName, undefined, {
          sensitivity: "accent",
        }) === 0,
    )
  ) {
    fail("agent_state_conflict", "The agent display name is already in use.");
  }
  const agent: WorkforceAgent = {
    schemaVersion: 1,
    agentId,
    projectId: current.projectId,
    displayName,
    displayNameSource: input.displayName === undefined ? "generated" : "explicit",
    roleId: input.roleId,
    roleVersion: contract.version,
    roleContractHash: contract.contractHash,
    roleProfileHash: capabilityBinding.roleProfileHash,
    provider: input.provider ?? "any",
    capabilityHash: capabilityBinding.capabilityHash,
    skillIds,
    capabilityPackages: capabilityBinding.capabilityPackages,
    responsibilityPaths,
    parentAgentId: parent?.agentId ?? null,
    delegationDepth,
    status: "active",
    ...(input.origin === undefined ? {} : { origin: input.origin }),
    revision: 1,
    createdAt,
    updatedAt: createdAt,
  };
  const next = {
    ...current.value,
    agents: [...current.value.agents, agent].sort((a, b) => a.agentId.localeCompare(b.agentId)),
  };
  return transition({
    path: current.path,
    lockPath: current.lockPath,
    now,
    content: `${JSON.stringify(next, null, 2)}\n`,
    result: structuredClone(agent),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    expectedBefore: current.source,
    event: {
      type: "agent.registered",
      occurredAt: createdAt,
      actorAgentId: parent?.agentId ?? null,
      payload: {
        agentId: agent.agentId,
        displayName: agent.displayName,
        displayNameSource: agent.displayNameSource,
        roleId: agent.roleId,
        roleVersion: agent.roleVersion,
        roleContractHash: agent.roleContractHash,
        roleProfileHash: agent.roleProfileHash,
        capabilityHash: agent.capabilityHash,
        provider: agent.provider,
        parentAgentId: agent.parentAgentId,
        delegationDepth,
        ...(agent.origin === undefined ? {} : { origin: agent.origin }),
      },
    },
  });
}

export function registerAgent(input: {
  repositoryRoot: string;
  roleId: string;
  provider?: WorkforceProvider;
  responsibilityPaths?: string[];
  skillIds?: string[];
  capabilityPackageIds?: string[];
  parentAgentId?: string;
  displayName?: string;
  /** The team's or Lervo's own (ADR-0643); a caller that hires for a Lervo service says `lervo`. */
  origin?: AgentOrigin;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAgent> {
  return retryConcurrent(() => registerAgentOnce(input));
}
