import { type WorkforceAgent } from "./types.js";
import {
  assertRoleContractBinding,
  createRoleContractResolver,
  roleProfileHash,
  type RoleContractResolver,
} from "@lervo/roles";
import { digest, stableJson, fail, validAgent } from "./workforce-state-validation.js";
import {
  discoverCapabilityInventory,
  resolveCapabilities,
  type DiscoveredCapability,
} from "@lervo/capabilities";
import { withAgentDisplayIdentity } from "./agent-display-identity.js";
import { state, readBounded } from "./workforce-state-io.js";
import { resolve } from "node:path";
import { workforceLimits } from "./limits.js";

export interface AgentRegistry {
  schemaVersion: 1;
  kind: "lervo_agent_registry";
  agents: WorkforceAgent[];
}

export async function readAgentRegistryState(
  root: string,
  options: { readOnly?: boolean } = {},
): Promise<{
  path: string;
  lockPath: string;
  source: string | null;
  value: AgentRegistry;
  projectId: string;
}> {
  const current = await state(root, options);
  const path = resolve(current.base, "agents.json");
  const source = await readBounded(path);
  const value =
    source === null
      ? { schemaVersion: 1 as const, kind: "lervo_agent_registry" as const, agents: [] }
      : (JSON.parse(source) as AgentRegistry);
  if (
    value.schemaVersion !== 1 ||
    value.kind !== "lervo_agent_registry" ||
    !Array.isArray(value.agents) ||
    value.agents.length > workforceLimits.maximumAgents ||
    !value.agents.every((agent) => validAgent(agent, current.manifest.projectId))
  )
    fail("workforce_state_invalid", "The agent registry is invalid.");
  const ids = value.agents.map((agent) => agent.agentId);
  if (
    new Set(ids).size !== ids.length ||
    value.agents.some((agent) => agent.parentAgentId !== null && !ids.includes(agent.parentAgentId))
  )
    fail(
      "workforce_state_invalid",
      "The agent registry contains duplicate or missing parent identities.",
    );
  return {
    path,
    lockPath: resolve(current.base, "agents.lock"),
    source,
    value,
    projectId: current.manifest.projectId,
  };
}

/**
 * The role and capability sources one registry read checks every agent against. Each is read at
 * most once per registry read, so one read costs the same however many agents it holds.
 */
interface RegistryReadSources {
  resolveRole: RoleContractResolver;
  loadInventory(): Promise<readonly DiscoveredCapability[]>;
}

function registryReadSources(root: string): RegistryReadSources {
  let inventory: Promise<readonly DiscoveredCapability[]> | undefined;
  return {
    resolveRole: createRoleContractResolver(root),
    loadInventory: () => (inventory ??= discoverCapabilityInventory({ repositoryRoot: root })),
  };
}

export async function normalizeAgentRole(
  root: string,
  agent: WorkforceAgent,
  sources: RegistryReadSources = registryReadSources(root),
): Promise<WorkforceAgent> {
  // Retirement is terminal; removed role sources must not erase inspectable historical identities.
  if (
    agent.status === "retired" &&
    agent.roleVersion !== undefined &&
    agent.roleContractHash !== undefined
  )
    return agent;
  const contract = await sources.resolveRole(agent.roleId);
  const currentProfileHash = roleProfileHash(contract.definition.profile);
  const legacyCapabilityHash = digest(stableJson(contract.definition.profile.capabilities));
  if (agent.roleVersion === undefined || agent.roleContractHash === undefined) {
    if (
      contract.sourceKind !== "built_in" ||
      agent.roleProfileHash !== currentProfileHash ||
      agent.capabilityHash !== legacyCapabilityHash ||
      agent.capabilityPackages !== undefined
    ) {
      fail(
        "workforce_state_invalid",
        `Legacy agent ${agent.agentId} cannot be bound to the current built-in role contract.`,
      );
    }
    return { ...agent, roleVersion: contract.version, roleContractHash: contract.contractHash };
  }
  try {
    assertRoleContractBinding(contract, agent);
  } catch (error) {
    fail(
      "agent_state_conflict",
      `Agent ${agent.agentId} is bound to a stale role contract.`,
      error,
    );
  }
  if (agent.capabilityPackages === undefined) {
    if (agent.capabilityHash !== legacyCapabilityHash)
      fail("agent_state_conflict", `Agent ${agent.agentId} capability binding is stale.`);
    return agent;
  }
  const current = await resolveCapabilities({
    repositoryRoot: root,
    inventory: await sources.loadInventory(),
    projectId: agent.projectId,
    capabilityIds: agent.capabilityPackages.map((item) => item.capabilityId),
    provider: agent.provider,
    platform: process.platform,
    generatedAt: agent.updatedAt,
    allowedPermissions: Object.entries(contract.definition.profile.capabilities)
      .filter(([, decision]) => decision === "allow")
      .map(([permission]) => permission),
  });
  const packages = current.selected.map(
    ({ capabilityId, kind, version, contentHash, sourceKind }) => ({
      capabilityId,
      kind,
      version,
      contentHash,
      sourceKind,
    }),
  );
  if (stableJson(packages) !== stableJson(agent.capabilityPackages))
    fail("agent_state_conflict", `Agent ${agent.agentId} capability package binding is stale.`);
  const currentCapabilityHash = digest(
    stableJson({
      permissions: contract.definition.profile.capabilities,
      packages: packages.map(({ capabilityId, version, contentHash }) => ({
        capabilityId,
        version,
        contentHash,
      })),
    }),
  );
  if (agent.capabilityHash !== currentCapabilityHash)
    fail("agent_state_conflict", `Agent ${agent.agentId} capability binding is stale.`);
  return agent;
}

export function normalizeAgent(
  root: string,
  agent: WorkforceAgent,
  sources?: RegistryReadSources,
): Promise<WorkforceAgent> {
  return normalizeAgentRole(root, withAgentDisplayIdentity(agent), sources);
}

export async function registry(
  root: string,
  options: { readOnly?: boolean } = {},
): Promise<{
  path: string;
  lockPath: string;
  source: string | null;
  value: AgentRegistry;
  projectId: string;
}> {
  const current = await readAgentRegistryState(root, options);
  const value = current.value;
  const sources = registryReadSources(root);
  const normalized = await Promise.all(
    value.agents.map((agent) => normalizeAgent(root, agent, sources)),
  );
  return {
    path: current.path,
    lockPath: current.lockPath,
    source: current.source,
    value: { ...value, agents: normalized },
    projectId: current.projectId,
  };
}

export async function listAgents(
  root: string,
  options: { readOnly?: boolean } = {},
): Promise<WorkforceAgent[]> {
  return structuredClone(
    (await registry(root, options)).value.agents.map(withAgentDisplayIdentity),
  );
}
