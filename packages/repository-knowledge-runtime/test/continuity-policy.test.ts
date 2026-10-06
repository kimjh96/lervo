import { describe, expect, it } from "vitest";

import {
  continuityPolicyFromDelegation,
  delegationWithinContinuityLimits,
  parseConvergenceContinuityPolicy,
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
    expect(decision).toEqual({ kind: "renew", expiresAt: new Date(now + 30 * DAY).toISOString() });
    const current = delegation(now + 24 * HOUR);
    const renewed = renewedConvergenceDelegation({
      current,
      expiresAt: new Date(now + 30 * DAY).toISOString(),
      reviewedAt: new Date(now).toISOString(),
    });
    expect(convergenceDelegationScopeHash(renewed)).toBe(convergenceDelegationScopeHash(current));
    expect(renewed.parentAgentId).toBe(current.parentAgentId);
    expect(renewed.review.reviewerAgentId).toBe(current.review.reviewerAgentId);
    expect(renewed.review.planHash).not.toBe(current.review.planHash);
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

  it("never renews without a policy, past a revocation, or outside the limits", () => {
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
        delegation: delegation(now + HOUR, {
          resourceCeilings: { ...due.resourceCeilings, maximumProviderCalls: 8 },
        }),
        policy: loaded(policy()),
        now,
      }),
    ).toEqual({ kind: "outside_policy", reason: "ceiling_outside_policy" });
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
