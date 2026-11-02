import { listAgents } from "@lervo/agent-workforce";

import {
  continuityPolicyFromDelegation,
  delegationWithinContinuityLimits,
  narrowedToContinuityLimits,
  rolledContinuityPolicy,
  type ConvergenceContinuityPolicy,
} from "./continuity-policy.js";
import {
  adoptConvergenceContinuityPolicy,
  readConvergenceContinuityPolicy,
  writeConvergenceContinuityPolicy,
  type ConvergenceContinuityPolicyReading,
} from "./continuity-policy-store.js";
import type { ConvergenceDelegation } from "./delegation.js";
import {
  convergenceDelegationScopeHash,
  renewedConvergenceDelegation,
} from "./delegation-scope.js";

/** The owner's standing instruction a policy adopted on a delegated host cites (ADR-0469). */
export const OWNER_STANDING_CONTINUITY_REFERENCE = "ADR-0469";

/**
 * Adopts the owner's standing continuity instruction on a host where the owner already reviewed
 * a delegation: the adopted policy's limits and template are exactly that delegation's scope. A
 * host with no reviewed delegation, or with any policy file (including a revoked one), adopts
 * nothing.
 */
async function adoptStandingPolicy(input: {
  root: string;
  policyPath: string;
  delegation: ConvergenceDelegation;
  now: Date;
}): Promise<ConvergenceContinuityPolicyReading> {
  const agents = await listAgents(input.root, { readOnly: true });
  const parent = agents.find((agent) => agent.agentId === input.delegation.parentAgentId);
  if (parent === undefined || parent.status !== "active") return { status: "absent" };
  const policy: ConvergenceContinuityPolicy = continuityPolicyFromDelegation({
    delegation: input.delegation,
    parentRoleId: parent.roleId,
    authority: { kind: "owner_instruction", reference: OWNER_STANDING_CONTINUITY_REFERENCE },
    now: input.now,
  });
  return adoptConvergenceContinuityPolicy(input.policyPath, policy);
}

/**
 * ADR-0561: rolls an active policy's horizon forward before it can cap or end a renewal. The
 * write is compare-and-swap on the policy hash; a lost race or a failed write keeps the current
 * policy, and the next reconciliation tries again.
 */
async function rollPolicyHorizon(
  policyPath: string,
  policy: ConvergenceContinuityPolicyReading,
  now: Date,
): Promise<ConvergenceContinuityPolicyReading> {
  if (policy.status !== "loaded") return policy;
  const rolled = rolledContinuityPolicy(policy.policy, now);
  if (rolled === null) return policy;
  try {
    await writeConvergenceContinuityPolicy({
      path: policyPath,
      policy: rolled,
      expectedPolicyHash: policy.policy.policyHash,
    });
    return { status: "loaded", policy: rolled };
  } catch {
    return readConvergenceContinuityPolicy(policyPath);
  }
}

/** The local scope hash after narrowing to the policy limits, when narrowing changes it. */
export function narrowedScopeHash(
  delegation: ConvergenceDelegation,
  policy: ConvergenceContinuityPolicyReading,
): string | null {
  if (policy.status !== "loaded") return null;
  if (delegationWithinContinuityLimits(delegation, policy.policy) === "within") return null;
  const limits = narrowedToContinuityLimits(delegation, policy.policy);
  return limits === null
    ? null
    : convergenceDelegationScopeHash(
        renewedConvergenceDelegation({
          current: delegation,
          expiresAt: delegation.expiresAt,
          limits,
        }),
      );
}

/**
 * The host policy continuity decides under: the installed policy, else the owner's standing
 * policy adopted from an active reviewed delegation, with its horizon rolled forward when near
 * (ADR-0561). Reading never fails; a policy that cannot be adopted reads as absent.
 */
export async function currentContinuityPolicy(input: {
  root: string;
  policyPath: string | null;
  delegation: ConvergenceDelegation | null;
  now: Date;
}): Promise<ConvergenceContinuityPolicyReading> {
  if (input.policyPath === null) return { status: "absent" };
  let policy = await readConvergenceContinuityPolicy(input.policyPath);
  if (
    policy.status === "absent" &&
    input.delegation?.state === "active" &&
    Date.parse(input.delegation.expiresAt) > input.now.getTime()
  )
    policy = await adoptStandingPolicy({
      root: input.root,
      policyPath: input.policyPath,
      delegation: input.delegation,
      now: input.now,
    }).catch((): ConvergenceContinuityPolicyReading => ({ status: "absent" }));
  return rollPolicyHorizon(input.policyPath, policy, input.now);
}
