import { resolveRoleContract, roleProfileHash, type ResolvedRoleContract } from "@lervo/roles";

import { resolveAgentCapabilityBinding } from "./agent-capability-binding.js";
import type { WorkforceAgent } from "./types.js";

/** One agent's stale role binding and the binding the workforce role-binding refresh moves it to. */
export interface AgentMigration {
  before: WorkforceAgent;
  target: Pick<
    WorkforceAgent,
    "roleVersion" | "roleContractHash" | "roleProfileHash" | "capabilityHash" | "capabilityPackages"
  >;
  /** Repository-defined roles this refresh follows, for the reported refresh counts. */
  repositoryRoleIds: string[];
}

/**
 * The refresh one agent's stale binding needs, with the contract it moves to, or null when its
 * binding is current or is history. ADR-0209: a retired agent's exact binding is never refreshed
 * against a later role, and it stays readable after its role source is removed (ADR-0662).
 */
export async function agentMigrationOf(
  repositoryRoot: string,
  projectId: string,
  agent: WorkforceAgent,
): Promise<{ migration: AgentMigration; contract: ResolvedRoleContract } | null> {
  if (
    agent.status === "retired" &&
    agent.roleVersion !== undefined &&
    agent.roleContractHash !== undefined
  )
    return null;
  const contract = await resolveRoleContract(repositoryRoot, agent.roleId);
  if (
    agent.roleVersion === contract.version &&
    agent.roleContractHash === contract.contractHash &&
    agent.roleProfileHash === roleProfileHash(contract.definition.profile)
  )
    return null;
  const capabilityBinding = await resolveAgentCapabilityBinding({
    repositoryRoot,
    projectId,
    provider: agent.provider,
    contract,
    capabilityPackageIds: agent.capabilityPackages?.map((item) => item.capabilityId) ?? [],
    generatedAt: agent.updatedAt,
  });
  return {
    contract,
    migration: {
      before: structuredClone(agent),
      target: {
        roleVersion: contract.version,
        roleContractHash: contract.contractHash,
        ...capabilityBinding,
      },
      repositoryRoleIds: contract.sourceKind === "repository" ? [contract.roleId] : [],
    },
  };
}
