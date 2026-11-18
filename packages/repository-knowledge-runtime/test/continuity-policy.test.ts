import { describe, expect, it } from "vitest";

import {
  continuityPolicyFromDelegation,
  delegationWithinContinuityLimits,
  narrowedToContinuityLimits,
  parseConvergenceContinuityPolicy,
  rolledContinuityPolicy,
  sealConvergenceContinuityPolicy,
  type ConvergenceContinuityPolicy,
} from "../src/continuity-policy.js";
import {
  decideDelegationRenewal,
  decideDelegationSeed,
} from "../src/delegation-continuity-decision.js";
import type { ConvergenceDelegation } from "../src/delegation-contract.js";
import { convergenceDelegationPlanHash } from "../src/delegation-contract.js";
import {
  renewedConvergenceDelegation,
  convergenceDelegationScopeHash,
} from "../src/delegation-scope.js";
import {
  knowledgeConvergenceScopeHash,
  type KnowledgeConvergenceHostRecord,
} from "@lervo/sync-contract";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;
const now = Date.parse("2026-10-06T00:00:00.000Z");
const hash = (digit: string) => `sha256:${digit.repeat(64)}`;
const binding = {
  roleId: "developer",
  version: "1.0.0",
  contractHash: hash("1"),
  profileHash: hash("2"),
  capabilityHash: hash("3"),
};

function delegation(expiresAt: number, overrides: Partial<ConvergenceDelegation> = {}) {
  const plan: Omit<ConvergenceDelegation, "review"> = {
    schemaVersion: 1,
    projectId: "prj_continuity_policy",
    state: "active",
    parentAgentId: `agt_${"a".repeat(24)}`,
    parentRoleHash: hash("1"),
    roles: { generator: binding, reviewer: binding, writer: binding, integrator: binding },
    canonicalRoots: ["docs"],
    normalizationRoots: ["docs"],
    providers: ["codex"],
    verification: [{ suiteId: "repository.default.v1", suiteHash: hash("4") }],
    integrationTarget: {
      ref: "refs/heads/lervo/knowledge-integration",
      repositoryIdentityHash: hash("5"),
    },
    expiresAt: new Date(expiresAt).toISOString(),
    resourceCeilings: {
      maximumStages: 4,
      maximumDocuments: 4,
      maximumSourceBytes: 65_536,
      maximumProviderCalls: 4,
    },
    ...overrides,
  };
  return {
    ...plan,
    review: {
      reviewerAgentId: `agt_${"b".repeat(24)}`,
      reviewedAt: new Date(now - DAY).toISOString(),
      planHash: convergenceDelegationPlanHash(plan),
    },
  } satisfies ConvergenceDelegation;
}

function policy(
  overrides: Partial<Omit<ConvergenceContinuityPolicy, "policyId" | "policyHash">> = {},
): ConvergenceContinuityPolicy {
  const base = continuityPolicyFromDelegation({
    delegation: delegation(now + 10 * DAY),
    parentRoleId: "developer",
    authority: { kind: "owner_installed", reference: null },
    now: new Date(now),
  });
  const { policyId: _id, policyHash: _hash, ...body } = base;
  return sealConvergenceContinuityPolicy({ ...body, ...overrides });
}

const loaded = (value: ConvergenceContinuityPolicy) => ({
  status: "loaded" as const,
  policy: value,
});

describe("continuity policy contract", () => {
  it("seals a content-addressed policy and rejects any altered byte", () => {
    const value = policy();
    expect(value.policyId).toMatch(/^kcpol_[a-f0-9]{24}$/u);
    expect(parseConvergenceContinuityPolicy(structuredClone(value))).toEqual(value);
    expect(() =>
      parseConvergenceContinuityPolicy({
        ...value,
        horizonAt: new Date(now + 400 * DAY).toISOString(),
      }),
    ).toThrow(expect.objectContaining({ code: "convergence_continuity_policy_invalid" }));
    expect(() =>
      parseConvergenceContinuityPolicy({ ...value, renewal: { ...value.renewal, termDays: 365 } }),
    ).toThrow();
    expect(() => parseConvergenceContinuityPolicy({ ...value, extra: true })).toThrow();
  });

  it("derives limits and template from exactly one reviewed delegation", () => {
    const value = policy();
    expect(value.limits).toEqual({
      providers: ["codex"],
      resourceCeilings: delegation(now).resourceCeilings,
    });
    expect(value.template).toMatchObject({
      parentRoleId: "developer",
      canonicalRoots: ["docs"],
      verificationSuite: "repository_default",
    });
    expect(
      delegationWithinContinuityLimits(delegation(now, { providers: ["claude"] }), value),
    ).toBe("provider_outside_policy");
  });
});

describe("delegation renewal decision", () => {
  it("waits until the renewal window, then renews at the same scope within the horizon", () => {
    expect(
      decideDelegationRenewal({
        delegation: delegation(now + 5 * DAY),
        policy: loaded(policy()),
        now,
      }),
    ).toEqual({ kind: "current", renewAt: new Date(now + 5 * DAY - 48 * HOUR).toISOString() });
    const decision = decideDelegationRenewal({
      delegation: delegation(now + 24 * HOUR),
      policy: loaded(policy()),
      now,
    });
    // The next term starts where the previous one ends, not at the renewing host's clock.
    expect(decision).toEqual({
      kind: "renew",
      expiresAt: new Date(now + 24 * HOUR + 30 * DAY).toISOString(),
    });
    const current = delegation(now + 24 * HOUR);
    const renewed = renewedConvergenceDelegation({
      current,
      expiresAt: new Date(now + 30 * DAY).toISOString(),
    });
    expect(convergenceDelegationScopeHash(renewed)).toBe(convergenceDelegationScopeHash(current));
    expect(renewed.parentAgentId).toBe(current.parentAgentId);
    expect(renewed.review.reviewerAgentId).toBe(current.review.reviewerAgentId);
    expect(renewed.review.reviewedAt).toBe(current.review.reviewedAt);
    expect(renewed.review.planHash).not.toBe(current.review.planHash);
  });

  it("derives the same renewal from the same delegation at any instant inside the window (ADR-0478)", () => {
    const current = delegation(now + 24 * HOUR);
    const renewalAt = (instant: number) => {
      const decision = decideDelegationRenewal({
        delegation: current,
        policy: loaded(policy()),
        now: instant,
      });
      if (decision.kind !== "renew") throw new Error(`unexpected ${decision.kind}`);
      return renewedConvergenceDelegation({ current, expiresAt: decision.expiresAt });
    };
    // The WSL and Mac residents of the incident renewed twelve minutes apart.
    const first = renewalAt(now);
    expect(renewalAt(now + 12 * 60_000)).toEqual(first);
    expect(renewalAt(now + 23 * HOUR)).toEqual(first);
    expect(first.expiresAt).toBe(new Date(now + 24 * HOUR + 30 * DAY).toISOString());
    // A long-expired delegation resumes on the same lattice, outside its next window.
    const lapsed = decideDelegationRenewal({
      delegation: current,
      policy: loaded(policy()),
      now: now + 40 * DAY,
    });
    expect(lapsed).toEqual({
      kind: "renew",
      expiresAt: new Date(now + 24 * HOUR + 60 * DAY).toISOString(),
    });
  });

  it("renews an already expired delegation and caps the term at the horizon", () => {
    const short = policy({ horizonAt: new Date(now + 10 * DAY).toISOString() });
    expect(
      decideDelegationRenewal({ delegation: delegation(now - HOUR), policy: loaded(short), now }),
    ).toEqual({ kind: "renew", expiresAt: new Date(now + 10 * DAY).toISOString() });
    expect(
      decideDelegationRenewal({
        delegation: delegation(now + 10 * DAY - HOUR),
        policy: loaded(short),
        now: now + 9 * DAY,
      }),
    ).toEqual({ kind: "renew", expiresAt: new Date(now + 10 * DAY).toISOString() });
    expect(
      decideDelegationRenewal({
        delegation: delegation(now + 10 * DAY),
        policy: loaded(short),
        now: now + 9 * DAY,
      }),
    ).toEqual({ kind: "horizon_exhausted" });
  });

  it("never renews without a policy, past a revocation, or with no allowed provider", () => {
    const due = delegation(now + HOUR);
    expect(
      decideDelegationRenewal({ delegation: due, policy: { status: "absent" }, now }).kind,
    ).toBe("no_policy");
    expect(
      decideDelegationRenewal({
        delegation: { ...due, state: "revoked" },
        policy: loaded(policy()),
        now,
      }).kind,
    ).toBe("revoked");
    expect(
      decideDelegationRenewal({
        delegation: due,
        policy: loaded(policy({ state: "revoked" })),
        now,
      }).kind,
    ).toBe("policy_revoked");
    expect(
      decideDelegationRenewal({
        delegation: delegation(now + HOUR, { providers: ["claude"] }),
        policy: loaded(policy()),
        now,
      }),
    ).toEqual({ kind: "outside_policy", reason: "provider_outside_policy" });
  });

  it("renews a delegation outside the limits narrowed to them (ADR-0561)", () => {
    const wide = delegation(now + HOUR, {
      providers: ["codex", "claude"],
      resourceCeilings: { ...delegation(now).resourceCeilings, maximumProviderCalls: 8 },
    });
    const decision = decideDelegationRenewal({ delegation: wide, policy: loaded(policy()), now });
    expect(decision).toEqual({
      kind: "renew",
      expiresAt: new Date(now + HOUR + 30 * DAY).toISOString(),
      limits: { providers: ["codex"], resourceCeilings: delegation(now).resourceCeilings },
    });
    if (decision.kind !== "renew") throw new Error("expected a renewal");
    const renewed = renewedConvergenceDelegation({
      current: wide,
      expiresAt: decision.expiresAt,
      ...(decision.limits === undefined ? {} : { limits: decision.limits }),
    });
    expect(delegationWithinContinuityLimits(renewed, policy())).toBe("within");
    expect(renewed.canonicalRoots).toEqual(wide.canonicalRoots);
    expect(narrowedToContinuityLimits({ ...wide, providers: ["claude"] }, policy())).toBeNull();
  });

  it("rolls a policy horizon forward only when it nears, keeping every limit (ADR-0561)", () => {
    const far = policy();
    expect(rolledContinuityPolicy(far, new Date(now))).toBeNull();
    const near = policy({ horizonAt: new Date(now + 20 * DAY).toISOString() });
    const rolled = rolledContinuityPolicy(near, new Date(now))!;
    expect(rolled.horizonAt).toBe(new Date(now + 365 * DAY).toISOString());
    expect(rolled.issuedAt).toBe(new Date(now).toISOString());
    expect(rolled).toMatchObject({
      limits: near.limits,
      template: near.template,
      renewal: near.renewal,
      authority: near.authority,
    });
    expect(parseConvergenceContinuityPolicy(rolled)).toEqual(rolled);
    expect(
      rolledContinuityPolicy(policy({ state: "revoked" }), new Date(now + 400 * DAY)),
    ).toBeNull();
  });
});

describe("delegation seed decision", () => {
  function peer(
    hostHash: string,
    observedAt: number,
    providers: string[] = ["codex"],
  ): KnowledgeConvergenceHostRecord {
    const scope = { providers, resourceCeilings: delegation(now).resourceCeilings };
    return {
      schemaVersion: 1,
      projectId: "prj_continuity_policy",
      repositoryIdentityHash: hash("5"),
      hostHash,
      hostLabel: "wsl",
      observedAt: new Date(observedAt).toISOString(),
      delegation: {
        state: "active",
        expiresAt: new Date(now + 5 * DAY).toISOString(),
        scopeHash: knowledgeConvergenceScopeHash(scope),
        scope,
      },
      continuity: { policy: "active", horizonAt: null },
      owner: null,
      publication: { configured: false, status: null },
      resident: null,
      findings: [],
    };
  }

  it("prefers the freshest in-policy peer, then the template", () => {
    const decision = decideDelegationSeed({
      policy: loaded(policy()),
      peers: [peer(hash("7"), now - HOUR), peer(hash("8"), now), peer(hash("9"), now, ["claude"])],
      localHostHash: hash("6"),
      now,
    });
    expect(decision).toMatchObject({ kind: "peer", record: { hostHash: hash("8") } });
    expect(
      decideDelegationSeed({ policy: loaded(policy()), peers: [], localHostHash: null, now }),
    ).toEqual({ kind: "template", expiresAt: new Date(now + 30 * DAY).toISOString() });
    expect(
      decideDelegationSeed({
        policy: loaded(
          policy({ seeding: { fromPeer: true, fromTemplate: false }, template: null }),
        ),
        peers: [peer(hash("6"), now)],
        localHostHash: hash("6"),
        now,
      }),
    ).toEqual({ kind: "none", reason: "no_source" });
    expect(
      decideDelegationSeed({ policy: { status: "absent" }, peers: [], localHostHash: null, now }),
    ).toEqual({ kind: "none", reason: "no_policy" });
  });
});
