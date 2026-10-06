import type { KnowledgeConvergenceHostRecord } from "@lervo/sync-contract";

import {
  delegationWithinContinuityLimits,
  type ConvergenceContinuityPolicy,
} from "./continuity-policy.js";
import type { ConvergenceContinuityPolicyReading } from "./continuity-policy-store.js";
import type { ConvergenceDelegation } from "./delegation-contract.js";

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;

type ContinuityPolicyStatus = ConvergenceContinuityPolicyReading;

/**
 * What continuity may do for an existing delegation. `renew` is the only effect; every other
 * outcome is reported, and the ones a policy cannot settle need the owner.
 */
export type DelegationRenewalDecision =
  | { kind: "current"; renewAt: string }
  | { kind: "renew"; expiresAt: string }
  | { kind: "revoked" }
  | { kind: "no_policy" }
  | { kind: "policy_invalid" }
  | { kind: "policy_revoked" }
  | { kind: "outside_policy"; reason: "provider_outside_policy" | "ceiling_outside_policy" }
  | { kind: "horizon_exhausted" };

export function decideDelegationRenewal(input: {
  delegation: ConvergenceDelegation;
  policy: ContinuityPolicyStatus;
  now: number;
}): DelegationRenewalDecision {
  const { delegation, policy, now } = input;
  if (delegation.state === "revoked") return { kind: "revoked" };
  if (policy.status === "absent") return { kind: "no_policy" };
  if (policy.status === "invalid") return { kind: "policy_invalid" };
  const rules = policy.policy;
  if (rules.state === "revoked") return { kind: "policy_revoked" };
  const renewAt = Date.parse(delegation.expiresAt) - rules.renewal.windowHours * HOUR_MS;
  if (renewAt > now) return { kind: "current", renewAt: new Date(renewAt).toISOString() };
  const limits = delegationWithinContinuityLimits(delegation, rules);
  if (limits !== "within") return { kind: "outside_policy", reason: limits };
  const expiresAt = Math.min(
    nextTermEnd({
      previousExpiresAt: Date.parse(delegation.expiresAt),
      termMs: rules.renewal.termDays * DAY_MS,
      windowMs: rules.renewal.windowHours * HOUR_MS,
      now,
    }),
    Date.parse(rules.horizonAt),
  );
  if (expiresAt <= Math.max(now, Date.parse(delegation.expiresAt)))
    return { kind: "horizon_exhausted" };
  return { kind: "renew", expiresAt: new Date(expiresAt).toISOString() };
}

/**
 * ADR-0478: terms follow one another from the previous expiry, never from a host's clock. The
 * result is the first whole term past the previous expiry whose own renewal window has not
 * opened yet, so every host that renews the same delegation in the same window computes the same
 * expiry, and a long-expired delegation resumes on the same lattice.
 */
function nextTermEnd(input: {
  previousExpiresAt: number;
  termMs: number;
  windowMs: number;
  now: number;
}): number {
  const elapsed = Math.max(0, input.now + input.windowMs - input.previousExpiresAt);
  return input.previousExpiresAt + (Math.floor(elapsed / input.termMs) + 1) * input.termMs;
}

/** A peer record older than this no longer proves who owns the repository. */
const OWNER_RECORD_FRESH_MS = 2 * HOUR_MS;

export type DelegationAdoptionDecision =
  { kind: "adopt"; record: KnowledgeConvergenceHostRecord; expiresAt: string } | { kind: "none" };

/**
 * ADR-0478: a host that does not own the repository never renews; it adopts the owner's term.
 * Only a fresh record from the current owner at the identical scope, active and later than the
 * local expiry, qualifies, and the local policy must still permit that scope and term.
 */
export function decideDelegationAdoption(input: {
  delegation: ConvergenceDelegation;
  scopeHash: string;
  policy: ContinuityPolicyStatus;
  peers: readonly KnowledgeConvergenceHostRecord[];
  localHostHash: string | null;
  now: number;
}): DelegationAdoptionDecision {
  const { delegation, policy, now } = input;
  if (delegation.state !== "active" || policy.status !== "loaded") return { kind: "none" };
  const rules = policy.policy;
  if (rules.state === "revoked" || delegationWithinContinuityLimits(delegation, rules) !== "within")
    return { kind: "none" };
  const floor = Math.max(now, Date.parse(delegation.expiresAt));
  const owner = input.peers
    .filter(
      (record) =>
        record.hostHash !== input.localHostHash &&
        record.owner?.role === "owner" &&
        now - Date.parse(record.observedAt) <= OWNER_RECORD_FRESH_MS &&
        record.delegation?.state === "active" &&
        record.delegation.scopeHash === input.scopeHash &&
        Date.parse(record.delegation.expiresAt) > floor &&
        Date.parse(record.delegation.expiresAt) <= Date.parse(rules.horizonAt),
    )
    .sort(
      (left, right) =>
        Date.parse(right.delegation!.expiresAt) - Date.parse(left.delegation!.expiresAt),
    )[0];
  return owner === undefined
    ? { kind: "none" }
    : { kind: "adopt", record: owner, expiresAt: owner.delegation!.expiresAt };
}

export type DelegationSeedDecision =
  | { kind: "peer"; record: KnowledgeConvergenceHostRecord; expiresAt: string }
  | { kind: "template"; expiresAt: string }
  | { kind: "none"; reason: "no_policy" | "policy_invalid" | "policy_revoked" | "no_source" }
  | { kind: "horizon_exhausted" };

/**
 * A missing delegation is seeded from the freshest active peer scope of the same repository
 * identity, else from the policy template. A peer scope outside the policy limits is never used.
 */
export function decideDelegationSeed(input: {
  policy: ContinuityPolicyStatus;
  peers: readonly KnowledgeConvergenceHostRecord[];
  localHostHash: string | null;
  now: number;
}): DelegationSeedDecision {
  const { policy, now } = input;
  if (policy.status === "absent") return { kind: "none", reason: "no_policy" };
  if (policy.status === "invalid") return { kind: "none", reason: "policy_invalid" };
  const rules = policy.policy;
  if (rules.state === "revoked") return { kind: "none", reason: "policy_revoked" };
  const expiresAt = Math.min(now + rules.renewal.termDays * DAY_MS, Date.parse(rules.horizonAt));
  if (expiresAt <= now) return { kind: "horizon_exhausted" };
  const term = new Date(expiresAt).toISOString();
  if (rules.seeding.fromPeer) {
    const peer = [...input.peers]
      .filter(
        (candidate) =>
          candidate.hostHash !== input.localHostHash &&
          candidate.delegation?.state === "active" &&
          Date.parse(candidate.delegation.expiresAt) > now &&
          scopeWithinLimits(candidate.delegation.scope, rules),
      )
      .sort((left, right) => Date.parse(right.observedAt) - Date.parse(left.observedAt))[0];
    if (peer !== undefined) return { kind: "peer", record: peer, expiresAt: term };
  }
  if (rules.seeding.fromTemplate && rules.template !== null)
    return { kind: "template", expiresAt: term };
  return { kind: "none", reason: "no_source" };
}

function scopeWithinLimits(
  scope: Record<string, unknown>,
  policy: ConvergenceContinuityPolicy,
): boolean {
  const candidate = scope as Partial<Pick<ConvergenceDelegation, "providers" | "resourceCeilings">>;
  if (!Array.isArray(candidate.providers) || candidate.resourceCeilings === undefined) return false;
  return (
    delegationWithinContinuityLimits(
      { providers: candidate.providers, resourceCeilings: candidate.resourceCeilings },
      policy,
    ) === "within"
  );
}
