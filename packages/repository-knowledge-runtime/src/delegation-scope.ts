import { knowledgeConvergenceScopeHash } from "@lervo/sync-contract";

import {
  convergenceDelegationPlanHash,
  parseConvergenceDelegation,
  type ConvergenceDelegation,
} from "./delegation-contract.js";

/**
 * ADR-0469 exchangeable delegation scope: everything a delegation authorizes except the host-local
 * accountable agents, the review, and the term. Two delegations with equal scope hashes grant the
 * same work; only who answers for it and until when differ.
 */
export type ConvergenceDelegationScope = Omit<
  ConvergenceDelegation,
  "parentAgentId" | "review" | "expiresAt" | "state"
>;

export function convergenceDelegationScope(
  delegation: ConvergenceDelegation,
): ConvergenceDelegationScope {
  const {
    parentAgentId: _parent,
    review: _review,
    expiresAt: _expiresAt,
    state: _state,
    ...scope
  } = structuredClone(delegation);
  return scope;
}

export function convergenceDelegationScopeHash(delegation: ConvergenceDelegation): string {
  return knowledgeConvergenceScopeHash(convergenceDelegationScope(delegation));
}

/**
 * Binds a scope to this host's accountable agent and a new term. The parent reviews its own
 * continued scope, which ADR-0434 permits for an active accountable agent; the plan hash is
 * recomputed, so the result passes the ordinary delegation contract or throws.
 */
export function bindConvergenceDelegationScope(input: {
  scope: unknown;
  parentAgentId: string;
  expiresAt: string;
  reviewedAt: string;
}): ConvergenceDelegation {
  const scope = structuredClone(input.scope) as ConvergenceDelegationScope;
  const plan: Omit<ConvergenceDelegation, "review"> = {
    ...scope,
    state: "active",
    parentAgentId: input.parentAgentId,
    expiresAt: input.expiresAt,
  };
  return parseConvergenceDelegation({
    ...plan,
    review: {
      reviewerAgentId: input.parentAgentId,
      reviewedAt: input.reviewedAt,
      planHash: convergenceDelegationPlanHash(plan),
    },
  });
}

/**
 * Same-scope renewal: identical scope, parent, and reviewer; only the term and the review time
 * change. Any other change requires an owner-reviewed delegation.
 */
export function renewedConvergenceDelegation(input: {
  current: ConvergenceDelegation;
  expiresAt: string;
  reviewedAt: string;
}): ConvergenceDelegation {
  const { review, ...rest } = structuredClone(input.current);
  const plan: Omit<ConvergenceDelegation, "review"> = { ...rest, expiresAt: input.expiresAt };
  return parseConvergenceDelegation({
    ...plan,
    review: {
      reviewerAgentId: review.reviewerAgentId,
      reviewedAt: input.reviewedAt,
      planHash: convergenceDelegationPlanHash(plan),
    },
  });
}
