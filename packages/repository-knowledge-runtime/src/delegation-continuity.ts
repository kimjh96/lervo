import type { ProjectStorage } from "@lervo/project-storage";
import {
  calculateProjectIdentityHash,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";

import {
  readConvergenceContinuityPolicy,
  type ConvergenceContinuityPolicyReading,
} from "./continuity-policy-store.js";
import { currentContinuityPolicy, narrowedScopeHash } from "./delegation-continuity-policy.js";
import { loadConvergenceDelegation, type ConvergenceDelegation } from "./delegation.js";
import {
  decideDelegationAdoption,
  decideDelegationRenewal,
  decideDelegationSeed,
  type DelegationRenewalDecision,
} from "./delegation-continuity-decision.js";
import {
  recordDelegationContinuation,
  type DelegationContinuation,
} from "./delegation-continuity-event.js";
import type { ConvergenceDefinitionSource } from "./delegation-definition-acceptance.js";
import { installPeerScopeDefinitions } from "./delegation-definition-installation.js";
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
import type { DelegationWriter } from "./delegation-writer.js";
import type { ContinuityDelegationObservation } from "./continuity-findings.js";

export { OWNER_STANDING_CONTINUITY_REFERENCE } from "./delegation-continuity-policy.js";

type ContinuationKind = Pick<DelegationContinuation, "action" | "source">;

export interface DelegationContinuityResult {
  delegation: ContinuityDelegationObservation;
  scopeHash: string | null;
  policy: ConvergenceContinuityPolicyReading;
  renewal: DelegationRenewalDecision | null;
  continuation: (ContinuationKind & { planHash: string; expiresAt: string }) | null;
  /** ADR-0478: a renewal is due, but another host owns the repository and renews it. */
  awaitingOwner: boolean;
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

interface ContinuationContext {
  storage: ProjectStorage;
  policy: ConvergenceContinuityPolicyReading;
  hostHash: string | null;
  now: Date;
}

/** Applies one continued delegation through the reviewed plan/apply path and records it. */
async function applyContinuation(
  context: ContinuationContext,
  input: ContinuationKind & {
    previous: ConvergenceDelegation | null;
    next: ConvergenceDelegation;
    policyHash: string;
    sourceHostHash: string | null;
    renewal: DelegationRenewalDecision | null;
    /** ADR-0491: the asset manifest bytes a rebind binds with the delegation. */
    reviewedManifestBytes?: Uint8Array;
  },
): Promise<DelegationContinuityResult> {
  const { storage, now } = context;
  await applyConvergenceDelegationPlan(
    storage,
    await createConvergenceDelegationPlan(
      storage,
      input.next,
      input.reviewedManifestBytes === undefined
        ? {}
        : { reviewedManifestBytes: input.reviewedManifestBytes },
    ),
  );
  const scopeHash = convergenceDelegationScopeHash(input.next);
  recordDelegationContinuation(storage, {
    repositoryIdentityHash: calculateProjectIdentityHash(storage.manifest),
    action: input.action,
    source: input.source,
    policyHash: input.policyHash,
    previousPlanHash: input.previous?.review.planHash ?? null,
    planHash: input.next.review.planHash,
    scopeHash,
    expiresAt: input.next.expiresAt,
    observerHostHash: context.hostHash,
    sourceHostHash: input.sourceHostHash,
    occurredAt: now.toISOString(),
  });
  return {
    delegation: observe(input.next, now.getTime()),
    scopeHash,
    policy: context.policy,
    renewal: input.renewal,
    continuation: {
      action: input.action,
      source: input.source,
      planHash: input.next.review.planHash,
      expiresAt: input.next.expiresAt,
    },
    awaitingOwner: false,
    failureCode: null,
  };
}

/**
 * The owner keeps its delegation current: a rebind after a managed upgrade rewrote a bound suite
 * or role contract (ADR-0470), else a due same-scope renewal. Both derive every byte from the
 * previous delegation, the policy, and local definitions (ADR-0478).
 */
async function continueAsOwner(
  context: ContinuationContext,
  loaded: ConvergenceDelegation,
  renewal: DelegationRenewalDecision,
  policyHash: string | null,
): Promise<DelegationContinuityResult | null> {
  const now = context.now.getTime();
  const rebound =
    policyHash !== null &&
    loaded.state === "active" &&
    Date.parse(loaded.expiresAt) > now &&
    (renewal.kind === "current" || renewal.kind === "renew")
      ? await reboundConvergenceDelegation({
          root: context.storage.paths.repositoryRoot,
          current: loaded,
          now: context.now,
        })
      : null;
  if (rebound !== null && policyHash !== null)
    return applyContinuation(context, {
      action: "rebound",
      source: "binding_refresh",
      previous: loaded,
      next: rebound.delegation,
      policyHash,
      sourceHostHash: null,
      renewal,
      ...(rebound.reviewedManifestBytes === undefined
        ? {}
        : { reviewedManifestBytes: rebound.reviewedManifestBytes }),
    });
  if (renewal.kind !== "renew" || policyHash === null) return null;
  return applyContinuation(context, {
    action: "renewed",
    source: "renewal",
    previous: loaded,
    next: renewedConvergenceDelegation({
      current: loaded,
      expiresAt: renewal.expiresAt,
      ...(renewal.limits === undefined ? {} : { limits: renewal.limits }),
    }),
    policyHash,
    sourceHostHash: null,
    renewal,
  });
}

/**
 * Keeps this checkout's delegation continuous under the host policy. Only the convergence owner
 * renews or rebinds (ADR-0478); a follower adopts the owner's term, and a replica follower waits
 * for the owner's bytes. A missing delegation is seeded from a peer scope or the policy template
 * on any host, because there is nothing to diverge from. Every effect goes through the ordinary
 * reviewed plan/apply path and is recorded as an event.
 */
export async function continueConvergenceDelegation(input: {
  storage: ProjectStorage;
  policyPath: string | null;
  peers: readonly KnowledgeConvergenceHostRecord[];
  hostHash: string | null;
  /** Who may write the delegation now (ADR-0478). */
  writer: DelegationWriter;
  /** Where peer-bound definitions come from; null without Hub coordination. */
  definitions?: ConvergenceDefinitionSource | null;
  now: Date;
}): Promise<DelegationContinuityResult> {
  const root = input.storage.paths.repositoryRoot;
  const now = input.now.getTime();
  const { writer } = input;
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
      awaitingOwner: false,
      failureCode: null,
    };
  }
  const policy = await currentContinuityPolicy({
    root,
    policyPath: input.policyPath,
    delegation: loaded,
    now: input.now,
  });
  const base = {
    delegation: observe(loaded, now),
    scopeHash: loaded === null ? null : convergenceDelegationScopeHash(loaded),
    policy,
  };
  const policyHash = policy.status === "loaded" ? policy.policy.policyHash : null;
  const context: ContinuationContext = {
    storage: input.storage,
    policy,
    hostHash: input.hostHash,
    now: input.now,
  };
  try {
    if (loaded !== null) {
      const renewal = decideDelegationRenewal({ delegation: loaded, policy, now });
      if (writer === "owner")
        return (
          (await continueAsOwner(context, loaded, renewal, policyHash)) ?? {
            ...base,
            renewal,
            continuation: null,
            awaitingOwner: false,
            failureCode: null,
          }
        );
      const adoption =
        writer === "follower" && policyHash !== null
          ? decideDelegationAdoption({
              delegation: loaded,
              scopeHash: base.scopeHash!,
              narrowedScopeHash: narrowedScopeHash(loaded, policy),
              policy,
              peers: input.peers,
              localHostHash: input.hostHash,
              now,
            })
          : { kind: "none" as const };
      if (adoption.kind === "adopt" && policyHash !== null)
        return applyContinuation(context, {
          action: "adopted",
          source: "owner",
          previous: loaded,
          next: renewedConvergenceDelegation({
            current: loaded,
            expiresAt: adoption.expiresAt,
            ...(adoption.limits === undefined ? {} : { limits: adoption.limits }),
          }),
          policyHash,
          sourceHostHash: adoption.record.hostHash,
          renewal,
        });
      return {
        ...base,
        renewal,
        continuation: null,
        awaitingOwner: renewal.kind === "renew",
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
        awaitingOwner: false,
        failureCode: seed.kind === "none" ? null : "convergence_continuity_horizon_exhausted",
      };
    // ADR-0477: a peer scope may bind suites or roles this checkout lacks; install the exact
    // reviewed bytes first, so seeding and the plan revalidate them like any local definition.
    if (seed.kind === "peer")
      await installPeerScopeDefinitions({
        storage: input.storage,
        record: seed.record,
        expiresAt: seed.expiresAt,
        source: input.definitions ?? null,
        observerHostHash: input.hostHash,
        now: input.now,
      });
    const seeded =
      seed.kind === "peer"
        ? await seedDelegationFromPeerScope({
            root,
            scope: seed.record.delegation!.scope,
            expiresAt: seed.expiresAt,
            now: input.now,
          })
        : await seedDelegationFromTemplate({
            storage: input.storage,
            template: policy.policy.template!,
            expiresAt: seed.expiresAt,
            now: input.now,
          });
    return await applyContinuation(context, {
      action: "seeded",
      source: seed.kind === "peer" ? "peer" : "policy_template",
      previous: null,
      next: seeded,
      policyHash: policy.policy.policyHash,
      sourceHostHash: seed.kind === "peer" ? seed.record.hostHash : null,
      renewal: null,
    });
  } catch (error) {
    return {
      ...base,
      renewal:
        loaded === null ? null : decideDelegationRenewal({ delegation: loaded, policy, now }),
      continuation: null,
      awaitingOwner: false,
      failureCode: failureCodeOf(error),
    };
  }
}
