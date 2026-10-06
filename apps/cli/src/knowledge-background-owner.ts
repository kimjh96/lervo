import {
  defaultConvergenceContinuityPolicyPath,
  loadConvergenceDelegation,
  readConvergenceContinuityPolicy,
} from "@lervo/repository-knowledge-runtime";

export type KnowledgeBackgroundOwner = "delegation" | "continuity_policy";

/**
 * ADR-0469: who drains document normalization debt without the owner. An active, unexpired
 * delegation lets this host's resident normalize it now; an active host continuity policy lets
 * the resident seed such a delegation on its next cycle. Null means no automatic owner exists,
 * so provider selection is genuinely the owner's decision.
 */
export async function knowledgeBackgroundOwner(
  repositoryRoot: string,
  now: Date = new Date(),
): Promise<KnowledgeBackgroundOwner | null> {
  const delegation = await loadConvergenceDelegation(repositoryRoot).catch(() => null);
  if (
    delegation !== null &&
    delegation.delegation.state === "active" &&
    Date.parse(delegation.delegation.expiresAt) > now.getTime()
  )
    return "delegation";
  // A revoked delegation is the owner's refusal; a policy never overrides it.
  if (delegation?.delegation.state === "revoked") return null;
  const path = defaultConvergenceContinuityPolicyPath();
  if (path === null) return null;
  const policy = await readConvergenceContinuityPolicy(path);
  return policy.status === "loaded" &&
    policy.policy.state === "active" &&
    Date.parse(policy.policy.horizonAt) > now.getTime() &&
    (delegation !== null || policy.policy.seeding.fromPeer || policy.policy.seeding.fromTemplate)
    ? "continuity_policy"
    : null;
}
