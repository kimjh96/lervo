import type { OperatingMandateV3 } from "@lervo/application-contract";
import { describe, expect, it } from "vitest";

import {
  assertDerivedMandate,
  assertOperatingMandate,
  assertMandateInstallationPlan,
  assertMandateExecutionSuccession,
  deriveSuccessorMandate,
  lineageRootId,
  operatingContractHash,
  planMandateInstallation,
  successorId,
  successorIndexOf,
} from "../src/index.js";

const hash = (letter = "a") => `sha256:${letter.repeat(64)}`;

function root(maximumSuccessors = 3): OperatingMandateV3 {
  return {
    schemaVersion: 3,
    mandateId: "mandate.standing",
    version: 2,
    appointingAuthorityId: "user.founder",
    ownerAgentId: `agt_${"a".repeat(24)}`,
    projectIds: [`prj_${"a".repeat(16)}`],
    teamIds: ["team_project01"],
    actionKinds: ["allocate_existing", "dispatch"],
    roleIds: ["researcher"],
    capabilityCeiling: ["repository.read"],
    pathRoots: ["docs"],
    providers: ["codex"],
    maximumWorkers: 2,
    maximumConcurrentAttempts: 1,
    maximumAttemptsPerAssignment: 2,
    maximumAttemptTokens: 1000,
    maximumAggregateTokens: 10000,
    maximumDeadlineMs: 3600000,
    issuedAt: "2026-09-15T00:00:00.000Z",
    expiresAt: "2026-12-15T00:00:00.000Z",
    revocationCoordinate: "mandate.standing.revocation",
    executionAuthority: { schemaVersion: 1, mode: "designated_host", hostIdentityHash: hash("b") },
    workScope: {
      schemaVersion: 1,
      workstreamId: `wks_${"1".repeat(24)}`,
      snapshotEventId: `evt_${"1".repeat(32)}`,
      snapshotEventHash: hash("1"),
      excludedAssignments: [],
    },
    successorAuthority: { schemaVersion: 1, maximumSuccessors },
  };
}

const scope = (letter: string) => ({
  workstreamId: `wks_${letter.repeat(24)}`,
  snapshotEventId: `evt_${letter.repeat(32)}`,
  snapshotEventHash: hash(letter),
});

describe("standing successor mandates", () => {
  it("derives a lineage-indexed successor with identical bounds and one fewer grant", () => {
    const parent = root(3);
    const child = deriveSuccessorMandate(parent, {
      successorIndex: 1,
      workScope: scope("2"),
      issuedAt: "2026-09-16T00:00:00.000Z",
    });
    expect(child.mandateId).toBe("mandate.standing.s1");
    expect(child.revocationCoordinate).toBe("mandate.standing.revocation.s1");
    expect(child.version).toBe(1);
    expect(child.expiresAt).toBe(parent.expiresAt);
    expect(child.workScope).toEqual({ schemaVersion: 1, ...scope("2"), excludedAssignments: [] });
    expect(child.successorAuthority).toEqual({ schemaVersion: 1, maximumSuccessors: 2 });
    expect(child.maximumAggregateTokens).toBe(parent.maximumAggregateTokens);
    const grandchild = deriveSuccessorMandate(child, {
      successorIndex: 2,
      workScope: scope("3"),
      issuedAt: "2026-09-17T00:00:00.000Z",
    });
    expect(grandchild.mandateId).toBe("mandate.standing.s2");
    expect(successorIndexOf(grandchild.mandateId)).toBe(2);
    expect(lineageRootId(grandchild.mandateId)).toBe("mandate.standing");
    expect(successorId("supervision.standing.s4", 5)).toBe("supervision.standing.s5");
    const third = deriveSuccessorMandate(grandchild, {
      successorIndex: 3,
      workScope: scope("4"),
      issuedAt: "2026-09-18T00:00:00.000Z",
    });
    expect(third.successorAuthority).toBeUndefined();
    expect(() =>
      deriveSuccessorMandate(third, {
        successorIndex: 4,
        workScope: scope("5"),
        issuedAt: "2026-09-19T00:00:00.000Z",
      }),
    ).toThrow(/no successor authority/u);
  });

  it("refuses derivation without a grant, out of order, or outside the parent's validity", () => {
    const { successorAuthority: _grant, ...ungranted } = root();
    expect(() =>
      deriveSuccessorMandate(ungranted as OperatingMandateV3, {
        successorIndex: 1,
        workScope: scope("2"),
        issuedAt: "2026-09-16T00:00:00.000Z",
      }),
    ).toThrow(/no successor authority/u);
    expect(() =>
      deriveSuccessorMandate(root(), {
        successorIndex: 2,
        workScope: scope("2"),
        issuedAt: "2026-09-16T00:00:00.000Z",
      }),
    ).toThrow(/does not follow/u);
    expect(() =>
      deriveSuccessorMandate(root(), {
        successorIndex: 1,
        workScope: scope("2"),
        issuedAt: "2027-01-01T00:00:00.000Z",
      }),
    ).toThrow(/outside its parent/u);
  });

  it("uses an independently reviewed per-goal ceiling after a larger running-goal renewal", () => {
    const parent: OperatingMandateV3 = {
      ...root(3),
      maximumAggregateTokens: 4_000_000,
      aggregateTokenPolicy: { schemaVersion: 1, mode: "per_attempt_only" },
      successorAuthority: {
        schemaVersion: 2,
        maximumSuccessors: 3,
        maximumAggregateTokens: 2_000_000,
      },
    };
    const child = deriveSuccessorMandate(parent, {
      successorIndex: 1,
      workScope: scope("2"),
      issuedAt: "2026-09-16T00:00:00.000Z",
    });
    expect(child.maximumAggregateTokens).toBe(2_000_000);
    expect(child.aggregateTokenPolicy).toEqual({ schemaVersion: 1, mode: "per_attempt_only" });
    expect(child.successorAuthority).toEqual({
      schemaVersion: 2,
      maximumSuccessors: 2,
      maximumAggregateTokens: 2_000_000,
    });
  });

  it("preserves one post-revocation owner allowance across successor goals", () => {
    const parent: OperatingMandateV3 = {
      ...root(),
      ownerSpendAllowance: {
        schemaVersion: 1,
        mode: "incremental_reservation",
        projectId: `prj_${"a".repeat(16)}`,
        anchorEventId: `evt_${"b".repeat(32)}`,
        anchorEventHash: hash("c"),
        maximumReservedTokens: 200_000,
      },
    };
    assertOperatingMandate(parent);
    const child = deriveSuccessorMandate(parent, {
      successorIndex: 1,
      workScope: scope("2"),
      issuedAt: "2026-09-16T00:00:00.000Z",
    });
    expect(child.ownerSpendAllowance).toEqual(parent.ownerSpendAllowance);
    const { ownerSpendAllowance: _allowance, ...stripped } = child;
    expect(() =>
      assertDerivedMandate(parent, stripped, {
        schemaVersion: 1,
        parentInstallationEventId: `evt_${"d".repeat(32)}`,
        parentMandateHash: operatingContractHash(parent),
        successorIndex: 1,
      }),
    ).toThrow();
    expect(() =>
      assertOperatingMandate({
        ...parent,
        ownerSpendAllowance: { ...parent.ownerSpendAllowance!, anchorEventHash: "invalid" },
      }),
    ).toThrow();
  });

  it("refuses a renewed per-attempt owner grant without a shared spend boundary", () => {
    const prior: OperatingMandateV3 = {
      ...root(),
      aggregateTokenPolicy: { schemaVersion: 1, mode: "per_attempt_only" },
    };
    const previous = {
      eventId: `evt_${"a".repeat(32)}`,
      latestEventId: `evt_${"b".repeat(32)}`,
      mandate: prior,
      mandateHash: operatingContractHash(prior),
      installationReviewHash: hash("c"),
      sourceRevisionDigest: hash("d"),
      revoked: true,
    };
    expect(() => assertMandateExecutionSuccession(previous, { ...prior, version: 3 })).toThrow(
      /spend allowance/u,
    );
    const renewed: OperatingMandateV3 = {
      ...prior,
      version: 3,
      ownerSpendAllowance: {
        schemaVersion: 1,
        mode: "incremental_reservation",
        projectId: prior.projectIds[0]!,
        anchorEventId: previous.latestEventId,
        anchorEventHash: hash("e"),
        maximumReservedTokens: 200_000,
      },
    };
    expect(() => assertMandateExecutionSuccession(previous, renewed)).not.toThrow();
    const installed = {
      ...previous,
      eventId: `evt_${"c".repeat(32)}`,
      latestEventId: `evt_${"c".repeat(32)}`,
      revoked: false,
      mandate: renewed,
      mandateHash: operatingContractHash(renewed),
    };
    const reset = (anchorEventId: string) => ({
      ...renewed,
      version: 4,
      ownerSpendAllowance: { ...renewed.ownerSpendAllowance!, anchorEventId },
    });
    // A running successor cannot raise or restart its epoch.
    expect(() =>
      assertMandateExecutionSuccession(installed, {
        ...renewed,
        version: 4,
        ownerSpendAllowance: { ...renewed.ownerSpendAllowance!, maximumReservedTokens: 300_000 },
      }),
    ).toThrow(/cannot reset/u);
    expect(() => assertMandateExecutionSuccession(installed, reset(installed.eventId))).toThrow(
      /cannot reset/u,
    );
    // After an explicit revocation a reviewed installation may open an epoch at that revocation only.
    const revoked = { ...installed, revoked: true, latestEventId: `evt_${"d".repeat(32)}` };
    expect(() =>
      assertMandateExecutionSuccession(revoked, reset(revoked.latestEventId)),
    ).not.toThrow();
    // Continuing the same epoch is not a reset; any other anchor than the revocation is.
    expect(() =>
      assertMandateExecutionSuccession(revoked, reset(previous.latestEventId)),
    ).not.toThrow();
    expect(() => assertMandateExecutionSuccession(revoked, reset(installed.eventId))).toThrow(
      /cannot reset/u,
    );
    expect(() =>
      assertMandateExecutionSuccession(revoked, {
        ...reset(revoked.latestEventId),
        ownerSpendAllowance: {
          ...reset(revoked.latestEventId).ownerSpendAllowance,
          projectId: `prj_${"f".repeat(16)}`,
        },
      }),
    ).toThrow(/cannot reset/u);
  });

  it("binds a derived plan to its parent installation and rejects widened bounds", () => {
    const parent = root();
    const child = deriveSuccessorMandate(parent, {
      successorIndex: 1,
      workScope: scope("2"),
      issuedAt: "2026-09-16T00:00:00.000Z",
    });
    const derivation = {
      schemaVersion: 1 as const,
      parentInstallationEventId: `evt_${"c".repeat(32)}`,
      parentMandateHash: operatingContractHash(parent),
      successorIndex: 1,
    };
    assertDerivedMandate(parent, child, derivation);
    expect(() =>
      assertDerivedMandate(parent, { ...child, maximumAggregateTokens: 20000 }, derivation),
    ).toThrow(/differs from what the standing grant permits/u);
    expect(() =>
      assertDerivedMandate(parent, child, { ...derivation, parentMandateHash: hash("f") }),
    ).toThrow(/does not bind its parent/u);
    const plan = planMandateInstallation({
      supervisionId: "supervision.standing.s1",
      mandate: child,
      source: {
        projectId: parent.projectIds[0]!,
        teamId: parent.teamIds[0]!,
        workstreamId: scope("2").workstreamId,
        workstreamRevision: 1,
        sourceRevisionDigest: hash("d"),
        causationEventIds: [`evt_${"d".repeat(32)}`],
        ownerAgentId: parent.ownerAgentId,
        eligible: true,
        reasonCodes: [],
      },
      previous: null,
      reviewerId: parent.appointingAuthorityId,
      now: "2026-09-16T00:00:00.000Z",
      derivation,
    });
    expect(plan.derivation).toEqual(derivation);
    assertMandateInstallationPlan(plan);
    expect(() =>
      assertMandateInstallationPlan({
        ...plan,
        derivation: { ...derivation, successorIndex: 2 },
      }),
    ).toThrow(/differs from its exact reviewed plan/u);
  });
});
