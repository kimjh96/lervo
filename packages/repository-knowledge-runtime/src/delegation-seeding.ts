import type { ProjectStorage } from "@lervo/project-storage";
import { resolve } from "node:path";

import {
  listAgents,
  registerAgent,
  resolveAgentCapabilityBinding,
  type WorkforceAgent,
} from "@lervo/agent-workforce";
import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { loadProjectManifest } from "@lervo/project";
import { resolveRoleContract, roleProfileHash } from "@lervo/roles";
import { loadVerificationSuite, verificationSuiteHash } from "@lervo/verification";
import { stat } from "node:fs/promises";

import type { ConvergenceDelegationTemplate } from "./continuity-policy.js";
import type {
  ConvergenceDelegation,
  ConvergenceRoleBinding,
  ConvergenceWorkerRole,
} from "./delegation-contract.js";
import {
  bindConvergenceDelegationScope,
  type ConvergenceDelegationScope,
} from "./delegation-scope.js";
import {
  ensureSeedDefaultSuite,
  repositorySuiteIds,
  selectRepositoryDefaultSuite,
} from "./default-knowledge-suite.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

const WORKER_ROLES: readonly ConvergenceWorkerRole[] = [
  "generator",
  "reviewer",
  "writer",
  "integrator",
];
export const CONTINUITY_STEWARD_DISPLAY_NAME = "Knowledge Steward";

/** Seeding failures name the missing local fact; none of them is retried within one cycle. */
function seedFailure(code: string): never {
  throw new KnowledgeConvergenceRuntimeError(code);
}

/**
 * The accountable parent on this host: an active root-most agent of the project whose role
 * contract matches. Only the template path may hire one, and only when none exists.
 */
async function localParent(input: {
  root: string;
  projectId: string;
  roleContractHash: string | null;
  /** Null matches any role with the contract hash; hiring then is impossible. */
  roleId: string | null;
  now: Date;
}): Promise<WorkforceAgent> {
  // Seeding may hire, so it initializes the coordination home of a fresh clone when needed.
  const agents = await listAgents(input.root);
  const parent = agents
    .filter(
      (agent) =>
        agent.status === "active" &&
        agent.projectId === input.projectId &&
        (input.roleId === null || agent.roleId === input.roleId) &&
        (input.roleContractHash === null || agent.roleContractHash === input.roleContractHash),
    )
    .sort(
      (left, right) =>
        left.delegationDepth - right.delegationDepth ||
        left.createdAt.localeCompare(right.createdAt) ||
        left.agentId.localeCompare(right.agentId),
    )[0];
  if (parent !== undefined) return parent;
  if (input.roleId === null) return seedFailure("convergence_seed_parent_missing");
  const hired = await registerAgent({
    repositoryRoot: input.root,
    roleId: input.roleId,
    displayName: CONTINUITY_STEWARD_DISPLAY_NAME,
    now: input.now,
    origin: "lervo",
  });
  if (input.roleContractHash !== null && hired.roleContractHash !== input.roleContractHash)
    seedFailure("convergence_seed_role_mismatch");
  return hired;
}

/** What a child of `parent` with this role and provider is bound to on this host. */
export async function localRoleBinding(input: {
  root: string;
  projectId: string;
  roleId: string;
  provider: "codex" | "claude";
  parent: WorkforceAgent;
  now: Date;
}): Promise<ConvergenceRoleBinding> {
  const contract = await resolveRoleContract(input.root, input.roleId);
  const capability = await resolveAgentCapabilityBinding({
    repositoryRoot: input.root,
    projectId: input.projectId,
    provider: input.provider,
    contract,
    capabilityPackageIds: (input.parent.capabilityPackages ?? []).map((item) => item.capabilityId),
    generatedAt: input.now.toISOString(),
  });
  return {
    roleId: input.roleId,
    version: contract.version,
    contractHash: contract.contractHash,
    profileHash: roleProfileHash(contract.definition.profile),
    capabilityHash: capability.capabilityHash,
  };
}

/** The suite seeding binds (`selectRepositoryDefaultSuite`), or the seed fails. */
async function repositoryDefaultSuite(root: string): Promise<string> {
  return (
    selectRepositoryDefaultSuite(await repositorySuiteIds(root)) ??
    seedFailure("convergence_seed_verification_missing")
  );
}

async function existingRoots(root: string, candidates: readonly string[]): Promise<string[]> {
  const present: string[] = [];
  for (const candidate of candidates) {
    if (
      await stat(resolve(root, candidate)).then(
        () => true,
        () => false,
      )
    )
      present.push(candidate);
  }
  return present;
}

/**
 * Builds this host's delegation from the policy template: roots that exist here, role pins and
 * capability bindings resolved locally, and the repository's own default suite.
 */
export async function seedDelegationFromTemplate(input: {
  storage: ProjectStorage;
  template: ConvergenceDelegationTemplate;
  expiresAt: string;
  now: Date;
}): Promise<ConvergenceDelegation> {
  // ADR-0655: a repository without a suite seeding can bind gets Lervo's default suite first.
  await ensureSeedDefaultSuite({ storage: input.storage, now: input.now });
  const root = input.storage.paths.repositoryRoot;
  const manifest = await loadProjectManifest(root);
  const projectId = manifest.projectId;
  const canonicalRoots = await existingRoots(root, input.template.canonicalRoots);
  const normalizationRoots = await existingRoots(root, input.template.normalizationRoots);
  if (canonicalRoots.length === 0 || normalizationRoots.length === 0)
    seedFailure("convergence_seed_roots_missing");
  const parent = await localParent({
    root: root,
    projectId,
    roleContractHash: null,
    roleId: input.template.parentRoleId,
    now: input.now,
  });
  const provider = input.template.providers[0]!;
  const roles = {} as Record<ConvergenceWorkerRole, ConvergenceRoleBinding>;
  for (const role of WORKER_ROLES)
    roles[role] = await localRoleBinding({
      root: root,
      projectId,
      roleId: input.template.roleIds[role],
      provider,
      parent,
      now: input.now,
    });
  const suiteId = await repositoryDefaultSuite(root);
  const scope: ConvergenceDelegationScope = {
    schemaVersion: 1,
    projectId,
    parentRoleHash: parent.roleContractHash,
    roles,
    canonicalRoots,
    normalizationRoots,
    providers: [...input.template.providers],
    verification: [
      {
        suiteId,
        suiteHash: verificationSuiteHash(await loadVerificationSuite(root, suiteId)),
      },
    ],
    integrationTarget: {
      ref: input.template.integrationRef,
      repositoryIdentityHash: calculateProjectIdentityHash(manifest),
    },
    resourceCeilings: { ...input.template.resourceCeilings },
  };
  return bindConvergenceDelegationScope({
    scope,
    parentAgentId: parent.agentId,
    expiresAt: input.expiresAt,
    reviewedAt: input.now.toISOString(),
  });
}

/**
 * Builds this host's delegation from a peer's exact scope. Only the accountable agent is local;
 * the scope must already hold here: same repository identity, and role pins and capability
 * bindings that this host resolves to identical hashes. Suites and roles are revalidated again
 * by the ordinary delegation plan.
 */
export async function seedDelegationFromPeerScope(input: {
  root: string;
  scope: Record<string, unknown>;
  expiresAt: string;
  now: Date;
}): Promise<ConvergenceDelegation> {
  const manifest = await loadProjectManifest(input.root);
  const scope = input.scope as Partial<ConvergenceDelegationScope>;
  if (
    scope.projectId !== manifest.projectId ||
    scope.integrationTarget?.repositoryIdentityHash !== calculateProjectIdentityHash(manifest) ||
    scope.roles === undefined ||
    typeof scope.parentRoleHash !== "string" ||
    !Array.isArray(scope.providers)
  )
    seedFailure("convergence_seed_identity_mismatch");
  // A worker role with the parent's contract names the role to hire when no local parent exists.
  const parentRoleId =
    Object.values(scope.roles!).find((binding) => binding.contractHash === scope.parentRoleHash)
      ?.roleId ?? null;
  const parent = await localParent({
    root: input.root,
    projectId: manifest.projectId,
    roleContractHash: scope.parentRoleHash!,
    roleId: null,
    now: input.now,
  }).catch((error: unknown) => {
    if (parentRoleId === null) throw error;
    return localParent({
      root: input.root,
      projectId: manifest.projectId,
      roleContractHash: scope.parentRoleHash!,
      roleId: parentRoleId,
      now: input.now,
    });
  });
  for (const role of WORKER_ROLES) {
    const pinned = scope.roles![role];
    const local = await localRoleBinding({
      root: input.root,
      projectId: manifest.projectId,
      roleId: pinned.roleId,
      provider: scope.providers![0] as "codex" | "claude",
      parent,
      now: input.now,
    });
    if (
      local.version !== pinned.version ||
      local.contractHash !== pinned.contractHash ||
      local.profileHash !== pinned.profileHash ||
      local.capabilityHash !== pinned.capabilityHash
    )
      seedFailure("convergence_seed_role_mismatch");
  }
  return bindConvergenceDelegationScope({
    scope: input.scope,
    parentAgentId: parent.agentId,
    expiresAt: input.expiresAt,
    reviewedAt: input.now.toISOString(),
  });
}
