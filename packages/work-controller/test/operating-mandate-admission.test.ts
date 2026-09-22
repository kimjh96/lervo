import { describe, expect, it } from "vitest";
import {
  assertOperatingMandate,
  operatingContractHash,
  operatingEffectAdmissionHash,
  reviewOperatingAction,
} from "../src/index.js";
import { hash, mandate, plan, snapshot } from "./operating-supervision.fixture.js";

describe("exact operating mandate admission", () => {
  it("rejects understated effect costs even when they fit the mandate", () => {
    const result = reviewOperatingAction({
      mandate: mandate(),
      plan: { ...plan(), reservedTokens: 1 },
      snapshot: snapshot(),
    });
    expect(result.reasonCodes).toContain("effect_scope_mismatch");
  });
  it("admits a bound action and binds the plan, current evidence and policy separately from manual topology review", () => {
    const result = reviewOperatingAction({
      mandate: mandate(),
      plan: plan(),
      snapshot: snapshot(),
    });
    expect(result.disposition).toBe("admitted");
    expect(result.reviewMode).toBe("mandate_policy_v1");
    expect(result.planHash).toBe(operatingContractHash(plan()));
    expect(result.snapshotHash).toBe(operatingContractHash(snapshot()));
    const changed = plan();
    changed.effectHash = hash("f");
    expect(
      reviewOperatingAction({ mandate: mandate(), plan: changed, snapshot: snapshot() }).decisionId,
    ).not.toBe(result.decisionId);
  });
  it.each([
    ["installedMandateHash", null, "mandate_not_installed"],
    ["installationReviewHash", null, "mandate_not_installed"],
    ["revoked", true, "mandate_revoked"],
    ["ancestryValid", false, "ancestry_invalid"],
    ["historyValid", false, "history_invalid"],
    ["sourceRevisionDigest", hash("f"), "source_changed"],
    ["graphHash", hash("f"), "source_changed"],
    ["activeWorkers", null, "capacity_unobserved"],
    ["activeAttempts", 2, "concurrency_exceeded"],
    ["assignmentCount", 256, "assignment_capacity_exceeded"],
    ["observedAggregateTokens", null, "usage_unobserved"],
    ["reservedAggregateTokens", 8000, "aggregate_budget_exceeded"],
    ["resourceAdmission", "unobserved", "resource_unobserved"],
    ["effectMappings", [], "effect_mapping_unavailable"],
  ] as const)("rejects %s without manufacturing authority", (field, value, reason) => {
    const result = reviewOperatingAction({
      mandate: mandate(),
      plan: plan(),
      snapshot: { ...snapshot(), [field]: value },
    });
    expect(result.disposition).toBe("blocked");
    expect(result.reasonCodes).toContain(reason);
  });
  it("rejects role, provider, capability, and path expansion including sibling prefixes", () => {
    const changed = {
      ...plan(),
      expectedPaths: ["src-other/a.ts"],
      roleId: "administrator",
      provider: "other-provider",
      requiredCapabilities: ["secret.read"],
    };
    expect(
      reviewOperatingAction({ mandate: mandate(), plan: changed, snapshot: snapshot() })
        .reasonCodes,
    ).toEqual(
      expect.arrayContaining([
        "path_scope_exceeded",
        "role_scope_exceeded",
        "provider_not_allowed",
        "capability_ceiling_exceeded",
      ]),
    );
  });
  it("admits repository-wide paths without cumulative usage under reviewed per-attempt policy", () => {
    const bounded = mandate();
    const current = {
      ...bounded,
      schemaVersion: 3 as const,
      pathRoots: ["*"],
      executionAuthority: {
        schemaVersion: 1 as const,
        mode: "designated_host" as const,
        hostIdentityHash: hash("e"),
      },
      workScope: {
        schemaVersion: 1 as const,
        workstreamId: plan().workstreamId,
        snapshotEventId: `evt_${"a".repeat(32)}`,
        snapshotEventHash: hash("d"),
        excludedAssignments: [],
      },
      aggregateTokenPolicy: { schemaVersion: 1 as const, mode: "per_attempt_only" as const },
    };
    const action = {
      ...plan(),
      mandateHash: operatingContractHash(current),
      expectedPaths: ["src/new-file.ts"],
    };
    const observation = {
      ...snapshot(),
      installedMandateHash: operatingContractHash(current),
      effectAdmissionHash: operatingEffectAdmissionHash(action),
      observedAggregateTokens: null,
      reservedAggregateTokens: null,
      resourceAdmission: "unobserved" as const,
    };
    expect(
      reviewOperatingAction({ mandate: current, plan: action, snapshot: observation }),
    ).toMatchObject({ disposition: "admitted", reasonCodes: [] });
  });
  it("blocks expired authority and responsibility edits under live leases", () => {
    const action = {
      ...plan(),
      actionKind: "revise_responsibility" as const,
      effectContract: "responsibility.revise.v1",
    };
    expect(
      reviewOperatingAction({
        mandate: mandate(),
        plan: action,
        snapshot: { ...snapshot(), liveResponsibilityLease: true },
      }).reasonCodes,
    ).toContain("responsibility_lease_unresolved");
    expect(
      reviewOperatingAction({
        mandate: mandate(),
        plan: plan(),
        snapshot: { ...snapshot(), observedAt: mandate().expiresAt },
      }).reasonCodes,
    ).toContain("mandate_expired");
  });
  it("rejects malformed contracts, traversal, unbounded retry and unknown secret fields", () => {
    expect(() =>
      assertOperatingMandate({ ...mandate(), credentials: "never-accepted" } as ReturnType<
        typeof mandate
      >),
    ).toThrow();
    for (const expectedPaths of [
      ["../outside"],
      ["src/../outside"],
      ["src\\outside"],
      ["/tmp/a"],
      ["src/*"],
    ]) {
      expect(() =>
        reviewOperatingAction({
          mandate: mandate(),
          plan: { ...plan(), expectedPaths },
          snapshot: snapshot(),
        }),
      ).toThrow();
    }
    expect(
      reviewOperatingAction({
        mandate: mandate(),
        plan: { ...plan(), attemptNumber: 4 },
        snapshot: snapshot(),
      }).reasonCodes,
    ).toContain("retry_limit_exceeded");
  });
});
