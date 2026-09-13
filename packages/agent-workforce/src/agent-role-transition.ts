import { type WorkforceEventRecorder, type WorkforceAgent } from "./types.js";
import { AGENT_ID, ROLE_ID, fail } from "./workforce-state-validation.js";
import { registry } from "./agent-registry.js";
import { withAgentDisplayIdentity } from "./agent-display-identity.js";
import { resolveRoleContract } from "@lervo/roles";
import { resolveAgentCapabilityBinding } from "./agent-capability-binding.js";
import { transition } from "./workforce-state-io.js";

export async function changeAgentRole(input: {
  repositoryRoot: string;
  agentId: string;
  roleId: string;
  expectedRevision: number;
  actorAgentId?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAgent> {
  if (!AGENT_ID.test(input.agentId) || !ROLE_ID.test(input.roleId) || input.roleId.length > 100) {
    fail("agent_invalid", "The agent role transition is invalid.");
  }
  const now = input.now ?? new Date();
  const current = await registry(input.repositoryRoot);
  const index = current.value.agents.findIndex((agent) => agent.agentId === input.agentId);
  if (index < 0) fail("agent_not_found", "The agent does not exist.");
  const existing = withAgentDisplayIdentity(current.value.agents[index]!);
  if (
    existing.revision !== input.expectedRevision ||
    existing.status !== "suspended" ||
    existing.roleId === input.roleId
  ) {
    fail(
      "agent_state_conflict",
      "An exact suspended agent and a different role are required for role transition.",
    );
  }
  const contract = await resolveRoleContract(input.repositoryRoot, input.roleId);
  const capabilityBinding = await resolveAgentCapabilityBinding({
    repositoryRoot: input.repositoryRoot,
    projectId: current.projectId,
    provider: existing.provider,
    contract,
    capabilityPackageIds: existing.capabilityPackages?.map((item) => item.capabilityId) ?? [],
    generatedAt: now.toISOString(),
  });
  const agent: WorkforceAgent = {
    ...existing,
    roleId: contract.roleId,
    roleVersion: contract.version,
    roleContractHash: contract.contractHash,
    ...capabilityBinding,
    revision: existing.revision + 1,
    updatedAt: now.toISOString(),
  };
  const agents = current.value.agents.map((candidate, candidateIndex) =>
    candidateIndex === index ? agent : candidate,
  );
  return transition({
    path: current.path,
    lockPath: current.lockPath,
    now,
    content: `${JSON.stringify({ ...current.value, agents }, null, 2)}\n`,
    result: structuredClone(agent),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    expectedBefore: current.source,
    event: {
      type: "agent.identity.changed",
      occurredAt: agent.updatedAt,
      actorAgentId: input.actorAgentId ?? null,
      payload: {
        changeKind: "role_binding",
        agentId: agent.agentId,
        previousDisplayName: existing.displayName,
        displayName: agent.displayName,
        displayNameSource: agent.displayNameSource,
        previousRoleId: existing.roleId,
        previousRoleVersion: existing.roleVersion,
        previousRoleContractHash: existing.roleContractHash,
        previousRoleProfileHash: existing.roleProfileHash,
        roleId: agent.roleId,
        roleVersion: agent.roleVersion,
        roleContractHash: agent.roleContractHash,
        roleProfileHash: agent.roleProfileHash,
        capabilityHash: agent.capabilityHash,
        revision: agent.revision,
      },
    },
  });
}
