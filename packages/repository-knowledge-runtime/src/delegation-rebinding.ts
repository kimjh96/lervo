import { listAgents } from "@lervo/agent-workforce";
import { canonicalJson } from "@lervo/repository-knowledge";
import { loadVerificationSuite, verificationSuiteHash } from "@lervo/verification";

import {
  convergenceDelegationPlanHash,
  parseConvergenceDelegation,
  type ConvergenceDelegation,
  type ConvergenceRoleBinding,
  type ConvergenceWorkerRole,
} from "./delegation-contract.js";
import { localRoleBinding } from "./delegation-seeding.js";

const WORKER_ROLES: readonly ConvergenceWorkerRole[] = [
  "generator",
  "reviewer",
  "writer",
  "integrator",
];

/**
 * ADR-0470 identity-preserving rebind. A Lervo-managed upgrade can rewrite a delegation-bound
 * verification suite or refresh a built-in role contract; the delegation then pins stale hashes
 * and fails its own binding check. The rebind keeps every scope identifier — suite IDs, role IDs,
 * roots, providers, ceilings, integration target, parent, reviewer, and expiry — and refreshes
 * only the content hashes those identifiers resolve to now. Any changed identifier is a scope
 * change and still needs an owner-reviewed delegation. Null means nothing drifted, or the parent
 * agent is no longer active here, so no rebind is possible.
 */
export async function reboundConvergenceDelegation(input: {
  root: string;
  current: ConvergenceDelegation;
  now: Date;
}): Promise<ConvergenceDelegation | null> {
  const { current } = input;
  const parent = (await listAgents(input.root, { readOnly: true })).find(
    (agent) => agent.agentId === current.parentAgentId && agent.status === "active",
  );
  if (parent === undefined) return null;
  const roles = {} as Record<ConvergenceWorkerRole, ConvergenceRoleBinding>;
  for (const role of WORKER_ROLES)
    roles[role] = await localRoleBinding({
      root: input.root,
      projectId: current.projectId,
      roleId: current.roles[role].roleId,
      provider: current.providers[0]!,
      parent,
      now: input.now,
    });
  const verification = [];
  for (const suite of current.verification)
    verification.push({
      suiteId: suite.suiteId,
      suiteHash: verificationSuiteHash(await loadVerificationSuite(input.root, suite.suiteId)),
    });
  const { review, ...rest } = structuredClone(current);
  const plan: Omit<ConvergenceDelegation, "review"> = {
    ...rest,
    parentRoleHash: parent.roleContractHash,
    roles,
    verification,
  };
  const { review: _review, ...unchanged } = current;
  if (canonicalJson(plan) === canonicalJson(unchanged)) return null;
  return parseConvergenceDelegation({
    ...plan,
    // ADR-0478: a rebind is a continuation, not a review; equal inputs give equal bytes.
    review: {
      reviewerAgentId: review.reviewerAgentId,
      reviewedAt: review.reviewedAt,
      planHash: convergenceDelegationPlanHash(plan),
    },
  });
}
