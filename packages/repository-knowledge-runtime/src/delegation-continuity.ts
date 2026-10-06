import { listAgents } from "@lervo/agent-workforce";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  calculateProjectIdentityHash,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";

import {
  continuityPolicyFromDelegation,
  type ConvergenceContinuityPolicy,
} from "./continuity-policy.js";
import {
  adoptConvergenceContinuityPolicy,
  readConvergenceContinuityPolicy,
  type ConvergenceContinuityPolicyReading,
} from "./continuity-policy-store.js";
import { loadConvergenceDelegation, type ConvergenceDelegation } from "./delegation.js";
import {
  decideDelegationRenewal,
  decideDelegationSeed,
  type DelegationRenewalDecision,
} from "./delegation-continuity-decision.js";
import { recordDelegationContinuation } from "./delegation-continuity-event.js";
import {
  applyConvergenceDelegationPlan,
  createConvergenceDelegationPlan,
} from "./delegation-plan.js";
import {
  convergenceDelegationScopeHash,
  renewedConvergenceDelegation,
} from "./delegation-scope.js";
import { reboundConvergenceDelegation } from "./delegation-rebinding.js";
import { seedDelegationFromPeerScope, seedDelegationFromTemplate } from "./delegation-seeding.js";
import type { ContinuityDelegationObservation } from "./continuity-findings.js";

/** The owner's standing instruction a policy adopted on a delegated host cites (ADR-0469). */
export const OWNER_STANDING_CONTINUITY_REFERENCE = "ADR-0469";

export interface DelegationContinuityResult {
  delegation: ContinuityDelegationObservation;
  scopeHash: string | null;
  policy: ConvergenceContinuityPolicyReading;
  renewal: DelegationRenewalDecision | null;
  continuation: {
    action: "renewed" | "seeded" | "rebound";
    source: "renewal" | "peer" | "policy_template" | "binding_refresh";
    planHash: string;
    expiresAt: string;
  } | null;
  failureCode: string | null;
}

function observe(
  loaded: ConvergenceDelegation | null,
  now: number,
): ContinuityDelegationObservation {
  if (loaded === null) return { state: "missing" };
  if (loaded.state === "revoked") return { state: "revoked", expiresAt: loaded.expiresAt };
  return Date.parse(loaded.expiresAt) <= now
    ? { state: "expired", expiresAt: loaded.expiresAt }
    : { state: "active", expiresAt: loaded.expiresAt };
}

function failureCodeOf(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code)
    ? code
    : "convergence_continuation_failed";
}

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
 * Keeps this checkout's delegation continuous under the host policy: renews a due delegation at
 * the identical scope, or seeds a missing one from a peer scope or the policy template. Every
 * effect goes through the ordinary reviewed plan/apply path and is recorded as an event.
 */
export async function continueConvergenceDelegation(input: {
  storage: ProjectStorage;
  policyPath: string | null;
  peers: readonly KnowledgeConvergenceHostRecord[];
  hostHash: string | null;
  now: Date;
}): Promise<DelegationContinuityResult> {
  const root = input.storage.paths.repositoryRoot;
  const now = input.now.getTime();
  let loaded: ConvergenceDelegation | null;
  try {
    loaded = (await loadConvergenceDelegation(root))?.delegation ?? null;
  } catch {
    return {
      delegation: { state: "invalid" },
      scopeHash: null,
      policy:
        input.policyPath === null
          ? { status: "absent" }
          : await readConvergenceContinuityPolicy(input.policyPath),
      renewal: null,
      continuation: null,
      failureCode: null,
    };
  }
  let policy: ConvergenceContinuityPolicyReading =
    input.policyPath === null
      ? { status: "absent" }
      : await readConvergenceContinuityPolicy(input.policyPath);
  if (
    policy.status === "absent" &&
    input.policyPath !== null &&
    loaded?.state === "active" &&
    Date.parse(loaded.expiresAt) > now
  )
    policy = await adoptStandingPolicy({
      root,
      policyPath: input.policyPath,
      delegation: loaded,
      now: input.now,
    }).catch((): ConvergenceContinuityPolicyReading => ({ status: "absent" }));
  const base = {
    delegation: observe(loaded, now),
    scopeHash: loaded === null ? null : convergenceDelegationScopeHash(loaded),
    policy,
  };
  const policyHash = policy.status === "loaded" ? policy.policy.policyHash : null;
  const identity = calculateProjectIdentityHash(input.storage.manifest);
  try {
    if (loaded !== null) {
      const renewal = decideDelegationRenewal({ delegation: loaded, policy, now });
      // ADR-0470: a managed upgrade that rewrote a bound suite or role contract is followed by an
      // identity-preserving rebind before any renewal, through the same plan/apply and event.
      const rebound =
        policyHash !== null &&
        loaded.state === "active" &&
        Date.parse(loaded.expiresAt) > now &&
        (renewal.kind === "current" || renewal.kind === "renew")
          ? await reboundConvergenceDelegation({ root, current: loaded, now: input.now })
          : null;
      if (rebound !== null && policyHash !== null) {
        await applyConvergenceDelegationPlan(
          input.storage,
          await createConvergenceDelegationPlan(input.storage, rebound),
        );
        recordDelegationContinuation(input.storage, {
          repositoryIdentityHash: identity,
          action: "rebound",
          source: "binding_refresh",
          policyHash,
          previousPlanHash: loaded.review.planHash,
          planHash: rebound.review.planHash,
          scopeHash: convergenceDelegationScopeHash(rebound),
          expiresAt: rebound.expiresAt,
          observerHostHash: input.hostHash,
          sourceHostHash: null,
          occurredAt: input.now.toISOString(),
        });
        return {
          delegation: observe(rebound, now),
          scopeHash: convergenceDelegationScopeHash(rebound),
          policy,
          renewal,
          continuation: {
            action: "rebound",
            source: "binding_refresh",
            planHash: rebound.review.planHash,
            expiresAt: rebound.expiresAt,
          },
          failureCode: null,
        };
      }
      if (renewal.kind !== "renew" || policyHash === null)
        return { ...base, renewal, continuation: null, failureCode: null };
      const next = renewedConvergenceDelegation({
        current: loaded,
        expiresAt: renewal.expiresAt,
        reviewedAt: input.now.toISOString(),
      });
      await applyConvergenceDelegationPlan(
        input.storage,
        await createConvergenceDelegationPlan(input.storage, next),
      );
      recordDelegationContinuation(input.storage, {
        repositoryIdentityHash: identity,
        action: "renewed",
        source: "renewal",
        policyHash,
        previousPlanHash: loaded.review.planHash,
        planHash: next.review.planHash,
        scopeHash: convergenceDelegationScopeHash(next),
        expiresAt: next.expiresAt,
        observerHostHash: input.hostHash,
        sourceHostHash: null,
        occurredAt: input.now.toISOString(),
      });
      return {
        delegation: observe(next, now),
        scopeHash: convergenceDelegationScopeHash(next),
        policy,
        renewal,
        continuation: {
          action: "renewed",
          source: "renewal",
          planHash: next.review.planHash,
          expiresAt: next.expiresAt,
        },
        failureCode: null,
      };
    }
    const seed = decideDelegationSeed({
      policy,
      peers: input.peers,
      localHostHash: input.hostHash,
      now,
    });
    if ((seed.kind !== "peer" && seed.kind !== "template") || policy.status !== "loaded")
      return {
        ...base,
        renewal: null,
        continuation: null,
        failureCode: seed.kind === "none" ? null : "convergence_continuity_horizon_exhausted",
      };
    const seeded =
      seed.kind === "peer"
        ? await seedDelegationFromPeerScope({
            root,
            scope: seed.record.delegation!.scope,
            expiresAt: seed.expiresAt,
            now: input.now,
          })
        : await seedDelegationFromTemplate({
            root,
            template: policy.policy.template!,
            expiresAt: seed.expiresAt,
            now: input.now,
          });
    await applyConvergenceDelegationPlan(
      input.storage,
      await createConvergenceDelegationPlan(input.storage, seeded),
    );
    const source = seed.kind === "peer" ? "peer" : "policy_template";
    recordDelegationContinuation(input.storage, {
      repositoryIdentityHash: identity,
      action: "seeded",
      source,
      policyHash: policy.policy.policyHash,
      previousPlanHash: null,
      planHash: seeded.review.planHash,
      scopeHash: convergenceDelegationScopeHash(seeded),
      expiresAt: seeded.expiresAt,
      observerHostHash: input.hostHash,
      sourceHostHash: seed.kind === "peer" ? seed.record.hostHash : null,
      occurredAt: input.now.toISOString(),
    });
    return {
      delegation: observe(seeded, now),
      scopeHash: convergenceDelegationScopeHash(seeded),
      policy,
      renewal: null,
      continuation: {
        action: "seeded",
        source,
        planHash: seeded.review.planHash,
        expiresAt: seeded.expiresAt,
      },
      failureCode: null,
    };
  } catch (error) {
    return {
      ...base,
      renewal:
        loaded === null ? null : decideDelegationRenewal({ delegation: loaded, policy, now }),
      continuation: null,
      failureCode: failureCodeOf(error),
    };
  }
}
