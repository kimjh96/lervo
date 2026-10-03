import { calculateProjectIdentityHash } from "@lervo/sync-contract";
import { loadProjectManifest } from "@lervo/project";
import { readRepositoryFile } from "@lervo/context";
import { listAgents } from "@lervo/agent-workforce";
import { sha256 } from "@lervo/repository-knowledge";
import { resolveRoleContract, roleProfileHash } from "@lervo/roles";
import { loadVerificationSuite, verificationSuiteHash } from "@lervo/verification";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { resolveConvergenceAssetDispositions } from "./asset-disposition-manifest.js";
import {
  CONVERGENCE_DELEGATION_PATH,
  parseConvergenceDelegation,
  type ConvergenceDelegation,
} from "./delegation-contract.js";
export * from "./delegation-contract.js";

/** Absence grants inspection only. Existing provider settings and role templates grant no delegation. */
export async function loadConvergenceDelegation(
  root: string,
): Promise<{ delegation: ConvergenceDelegation; contentHash: string } | null> {
  let bytes: Uint8Array;
  try {
    bytes = await readRepositoryFile(root, CONVERGENCE_DELEGATION_PATH, 64 * 1024);
  } catch (error) {
    if (
      ["ENOENT", "document_missing"].includes((error as NodeJS.ErrnoException).code ?? "") ||
      (error as { cause?: NodeJS.ErrnoException }).cause?.code === "ENOENT"
    )
      return null;
    throw error;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes));
  } catch {
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  }
  return { delegation: parseConvergenceDelegation(value), contentHash: sha256(bytes) };
}

/** Revalidates ancestry, role pins, capability bindings, suites, project, expiry, and revocation. */
export async function assertConvergenceDelegation(input: {
  repositoryRoot: string;
  projectId: string;
  expectedHash: string | null;
  provider: "codex" | "claude";
  now?: Date;
}): Promise<ConvergenceDelegation> {
  const loaded = await loadConvergenceDelegation(input.repositoryRoot);
  const now = input.now ?? new Date();
  if (
    loaded === null ||
    loaded.contentHash !== input.expectedHash ||
    loaded.delegation.projectId !== input.projectId ||
    loaded.delegation.state !== "active" ||
    Date.parse(loaded.delegation.expiresAt) <= now.getTime() ||
    !loaded.delegation.providers.includes(input.provider)
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  return assertConvergenceDelegationBindings(
    input.repositoryRoot,
    input.projectId,
    loaded.delegation,
  );
}

/** Plan/apply and execution share the same project, ancestry, role and suite authority checks. */
export async function assertConvergenceDelegationBindings(
  root: string,
  projectId: string,
  delegation: ConvergenceDelegation,
  reviewedManifestBytes?: Uint8Array,
): Promise<ConvergenceDelegation> {
  if (
    delegation.integrationTarget.repositoryIdentityHash !==
    calculateProjectIdentityHash(await loadProjectManifest(root))
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const agents = await listAgents(root, { readOnly: true });
  const parent = agents.find((agent) => agent.agentId === delegation.parentAgentId);
  const reviewer = agents.find((agent) => agent.agentId === delegation.review.reviewerAgentId);
  if (
    parent?.status !== "active" ||
    parent.projectId !== projectId ||
    parent.roleContractHash !== delegation.parentRoleHash ||
    !Number.isFinite(Date.parse(delegation.review.reviewedAt)) ||
    Date.parse(delegation.review.reviewedAt) > Date.now() ||
    reviewer?.status !== "active" ||
    reviewer.projectId !== projectId
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  let ancestor = parent;
  const visited = new Set<string>();
  while (ancestor.parentAgentId !== null) {
    if (visited.has(ancestor.agentId))
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    visited.add(ancestor.agentId);
    const next = agents.find((agent) => agent.agentId === ancestor.parentAgentId);
    if (next?.status !== "active" || next.delegationDepth + 1 !== ancestor.delegationDepth)
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
    ancestor = next;
  }
  if (
    reviewer.agentId !== parent.agentId &&
    reviewer.parentAgentId !== parent.agentId &&
    !visited.has(reviewer.agentId)
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  for (const binding of Object.values(delegation.roles)) {
    const role = await resolveRoleContract(root, binding.roleId);
    if (
      role.version !== binding.version ||
      role.contractHash !== binding.contractHash ||
      roleProfileHash(role.definition.profile) !== binding.profileHash
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  }
  for (const required of delegation.verification) {
    if (
      verificationSuiteHash(await loadVerificationSuite(root, required.suiteId)) !==
      required.suiteHash
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  }
  resolveConvergenceAssetDispositions(root, delegation, reviewedManifestBytes);
  return delegation;
}
