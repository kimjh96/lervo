import { createHash } from "node:crypto";

import { resolveRoleContract, roleProfileHash } from "@lervo/roles";
import { inspectRepositoryCoordinationHome } from "@lervo/project-storage";

import { resolveAgentCapabilityBinding } from "./agent-capability-binding.js";
import { readAgentRegistryState } from "./agent-registry.js";
import { listRawAssignmentStates } from "./assignment-state.js";
import type { WorkforceAgent, WorkforceAssignment, WorkforceEventRecorder } from "./types.js";
import { fail, stableJson } from "./workforce-state-validation.js";
import { transition } from "./workforce-state-io.js";

export interface WorkforceRoleBindingMigrationPlan {
  schemaVersion: 1;
  planKind: "workforce_role_binding_migration";
  planId: string;
  status: "current" | "ready" | "blocked";
  staleAgentCount: number;
  staleAssignmentCount: number;
  conflictCount: number;
  reason: string;
  privacy: {
    state: "counts_and_content_bound_plan_only";
    roleProse: "excluded";
    repositoryPaths: "excluded";
    providerConfiguration: "excluded";
  };
  failureMeaning: string;
}

interface AgentMigration {
  before: WorkforceAgent;
  target: Pick<
    WorkforceAgent,
    "roleVersion" | "roleContractHash" | "roleProfileHash" | "capabilityHash" | "capabilityPackages"
  >;
}

interface AssignmentMigration {
  before: WorkforceAssignment;
  target: Pick<WorkforceAssignment, "roleVersion" | "roleContractHash" | "requiredCapabilityHash">;
}

interface InternalPlan {
  publicPlan: WorkforceRoleBindingMigrationPlan;
  agents: AgentMigration[];
  assignments: AssignmentMigration[];
}

function planId(material: unknown): string {
  return `wrbm_${createHash("sha256").update(stableJson(material)).digest("hex").slice(0, 24)}`;
}

async function createInternalPlan(repositoryRoot: string): Promise<InternalPlan> {
  if ((await inspectRepositoryCoordinationHome(repositoryRoot)) === null) {
    return {
      agents: [],
      assignments: [],
      publicPlan: {
        schemaVersion: 1,
        planKind: "workforce_role_binding_migration",
        planId: planId({ schemaVersion: 1, workforceState: "absent" }),
        status: "current",
        staleAgentCount: 0,
        staleAssignmentCount: 0,
        conflictCount: 0,
        reason: "role_bindings_current",
        privacy: {
          state: "counts_and_content_bound_plan_only",
          roleProse: "excluded",
          repositoryPaths: "excluded",
          providerConfiguration: "excluded",
        },
        failureMeaning:
          "A stale, blocked, or failed migration proves no refreshed role authority or assignment execution.",
      },
    };
  }
  const registry = await readAgentRegistryState(repositoryRoot, { readOnly: true });
  const assignments = await listRawAssignmentStates(repositoryRoot);
  const agentMigrations: AgentMigration[] = [];
  const assignmentMigrations: AssignmentMigration[] = [];
  let conflictCount = 0;

  for (const agent of registry.value.agents) {
    const contract = await resolveRoleContract(repositoryRoot, agent.roleId);
    const roleBindingCurrent =
      agent.roleVersion === contract.version &&
      agent.roleContractHash === contract.contractHash &&
      agent.roleProfileHash === roleProfileHash(contract.definition.profile);
    if (roleBindingCurrent) continue;
    if (contract.sourceKind !== "built_in") {
      conflictCount += 1;
      continue;
    }
    const capabilityBinding = await resolveAgentCapabilityBinding({
      repositoryRoot,
      projectId: registry.projectId,
      provider: agent.provider,
      contract,
      capabilityPackageIds: agent.capabilityPackages?.map((item) => item.capabilityId) ?? [],
      generatedAt: agent.updatedAt,
    });
    agentMigrations.push({
      before: structuredClone(agent),
      target: {
        roleVersion: contract.version,
        roleContractHash: contract.contractHash,
        ...capabilityBinding,
      },
    });
  }

  for (const assignmentState of assignments) {
    const assignment = assignmentState.value;
    const contract = await resolveRoleContract(repositoryRoot, assignment.roleId);
    const roleBindingCurrent =
      assignment.roleVersion === contract.version &&
      assignment.roleContractHash === contract.contractHash;
    const capabilityTargets = new Set(
      agentMigrations
        .filter(
          (migration) =>
            assignment.requiredCapabilityHash !== null &&
            assignment.requiredCapabilityHash !== undefined &&
            migration.before.capabilityHash === assignment.requiredCapabilityHash,
        )
        .map((migration) => migration.target.capabilityHash),
    );
    if (capabilityTargets.size > 1) {
      conflictCount += 1;
      continue;
    }
    const requiredCapabilityHash =
      capabilityTargets.size === 1
        ? [...capabilityTargets][0]!
        : (assignment.requiredCapabilityHash ?? null);
    if (
      roleBindingCurrent &&
      requiredCapabilityHash === (assignment.requiredCapabilityHash ?? null)
    )
      continue;
    if (!roleBindingCurrent && contract.sourceKind !== "built_in") {
      conflictCount += 1;
      continue;
    }
    assignmentMigrations.push({
      before: structuredClone(assignment),
      target: {
        roleVersion: contract.version,
        roleContractHash: contract.contractHash,
        requiredCapabilityHash,
      },
    });
  }

  const material = {
    schemaVersion: 1,
    projectId: registry.projectId,
    agents: agentMigrations,
    assignments: assignmentMigrations,
    conflictCount,
  };
  const status =
    conflictCount > 0
      ? "blocked"
      : agentMigrations.length + assignmentMigrations.length > 0
        ? "ready"
        : "current";
  const reason =
    conflictCount > 0
      ? "repository_role_binding_requires_explicit_lifecycle_decision"
      : status === "ready"
        ? "stale_built_in_role_bindings"
        : "role_bindings_current";
  return {
    agents: agentMigrations,
    assignments: assignmentMigrations,
    publicPlan: {
      schemaVersion: 1,
      planKind: "workforce_role_binding_migration",
      planId: planId(material),
      status,
      staleAgentCount: agentMigrations.length,
      staleAssignmentCount: assignmentMigrations.length,
      conflictCount,
      reason,
      privacy: {
        state: "counts_and_content_bound_plan_only",
        roleProse: "excluded",
        repositoryPaths: "excluded",
        providerConfiguration: "excluded",
      },
      failureMeaning:
        "A stale, blocked, or failed migration proves no refreshed role authority or assignment execution.",
    },
  };
}

export async function createWorkforceRoleBindingMigrationPlan(
  repositoryRoot: string,
): Promise<WorkforceRoleBindingMigrationPlan> {
  return (await createInternalPlan(repositoryRoot)).publicPlan;
}

export async function applyWorkforceRoleBindingMigration(input: {
  repositoryRoot: string;
  approval: string;
  now?: Date;
  recordEvent: WorkforceEventRecorder;
}): Promise<{ migratedAgentCount: number; migratedAssignmentCount: number }> {
  const plan = await createInternalPlan(input.repositoryRoot);
  if (plan.publicPlan.planId !== input.approval)
    fail("agent_state_conflict", "The workforce role-binding migration plan changed before apply.");
  if (plan.publicPlan.status === "blocked")
    fail("agent_state_conflict", "Repository role drift requires an explicit workforce decision.");
  const now = input.now ?? new Date();

  // Assignments move first so an interrupted run still retains every old-to-new capability map
  // in the stale agent records needed to resume the remaining assignment refreshes.
  for (const migration of plan.assignments) {
    const current = (await listRawAssignmentStates(input.repositoryRoot)).find(
      (item) => item.value.assignmentId === migration.before.assignmentId,
    );
    if (current === undefined || stableJson(current.value) !== stableJson(migration.before))
      fail("agent_state_conflict", "The assignment role binding changed before migration apply.");
    const assignment: WorkforceAssignment = {
      ...current.value,
      ...migration.target,
      revision: current.value.revision + 1,
      updatedAt: now.toISOString(),
    };
    await transition({
      path: current.path,
      lockPath: current.lockPath,
      now,
      content: `${JSON.stringify(assignment, null, 2)}\n`,
      expectedBefore: current.source,
      result: undefined,
      recordEvent: input.recordEvent,
      event: {
        type: "assignment.role.binding.changed",
        occurredAt: assignment.updatedAt,
        actorAgentId: null,
        payload: {
          assignmentId: assignment.assignmentId,
          previousRoleVersion: current.value.roleVersion,
          previousRoleContractHash: current.value.roleContractHash,
          previousRequiredCapabilityHash: current.value.requiredCapabilityHash ?? null,
          roleId: assignment.roleId,
          roleVersion: assignment.roleVersion,
          roleContractHash: assignment.roleContractHash,
          requiredCapabilityHash: assignment.requiredCapabilityHash ?? null,
          revision: assignment.revision,
        },
      },
    });
  }

  for (const migration of plan.agents) {
    const current = await readAgentRegistryState(input.repositoryRoot);
    const index = current.value.agents.findIndex(
      (agent) => agent.agentId === migration.before.agentId,
    );
    const existing = current.value.agents[index];
    if (existing === undefined || stableJson(existing) !== stableJson(migration.before))
      fail("agent_state_conflict", "The agent role binding changed before migration apply.");
    const agent: WorkforceAgent = {
      ...existing,
      ...migration.target,
      revision: existing.revision + 1,
      updatedAt: now.toISOString(),
    };
    const agents = current.value.agents.map((candidate, candidateIndex) =>
      candidateIndex === index ? agent : candidate,
    );
    await transition({
      path: current.path,
      lockPath: current.lockPath,
      now,
      content: `${JSON.stringify({ ...current.value, agents }, null, 2)}\n`,
      expectedBefore: current.source,
      result: undefined,
      recordEvent: input.recordEvent,
      event: {
        type: "agent.identity.changed",
        occurredAt: agent.updatedAt,
        actorAgentId: null,
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

  return {
    migratedAgentCount: plan.agents.length,
    migratedAssignmentCount: plan.assignments.length,
  };
}
