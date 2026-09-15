import type { OperatingMandateV3 } from "@lervo/application-contract";
import { describe, expect, it } from "vitest";

import {
  assertDerivedMandate,
  assertMandateInstallationPlan,
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
