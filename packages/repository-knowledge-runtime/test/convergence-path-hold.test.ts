import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AssignmentPathRefusal, WorkforceAssignment } from "@lervo/agent-workforce";

import { convergencePathConflictHolds } from "../src/convergence-path-hold.js";

const workforce = vi.hoisted(() => ({
  assignments: [] as WorkforceAssignment[],
  refusals: new Map<string, AssignmentPathRefusal[]>(),
  judged: [] as string[],
}));
vi.mock("@lervo/agent-workforce", () => ({
  listAssignments: async () => workforce.assignments,
  readAssignmentClaimRefusals: async (input: { assignment: WorkforceAssignment }) => {
    workforce.judged.push(input.assignment.assignmentId);
    return workforce.refusals.get(input.assignment.assignmentId) ?? [];
  },
}));

const NOW = new Date("2026-11-27T00:00:00.000Z");
const OBLIGATION = "kob_0123456789abcdef01234567";

function assignment(
  assignmentId: string,
  extra: Record<string, unknown> = {},
): WorkforceAssignment {
  return {
    assignmentId,
    status: "queued",
    accessMode: "write",
    expectedPaths: ["docs/guide.md"],
    lease: null,
    convergence: { obligationId: OBLIGATION, stage: "normalization_apply" },
    ...extra,
  } as unknown as WorkforceAssignment;
}

/** Another agent's live write lease on a path the stage never touches. */
const unrelatedLease = assignment("asn_other", {
  status: "leased",
  convergence: undefined,
  expectedPaths: ["src/net/retry.ts"],
  lease: { expiresAt: "2026-11-27T00:10:00.000Z" },
});

const overlap: AssignmentPathRefusal = {
  code: "path_changed_unsealed",
  path: "docs/guide.md",
  holderAgentId: "agt_conversation_lead",
  holderAssignmentId: "asn_conversation",
  holderWorkspaceId: "wsp_0123456789abcdef01234567",
};

beforeEach(() => {
  workforce.assignments = [];
  workforce.refusals = new Map();
  workforce.judged = [];
});

describe("a convergence stage a claim refused", () => {
  const dependency = { obligationId: OBLIGATION, stage: "normalization_apply" };

  it("waits only while a holder overlaps its own paths", async () => {
    const stage = assignment("asn_stage");
    workforce.assignments = [stage, unrelatedLease];
    // Before, any live write lease held it; one that overlaps nothing no longer does.
    expect(await convergencePathConflictHolds("/repo", dependency, NOW)).toBe(false);
    expect(workforce.judged).toEqual(["asn_stage"]);
    workforce.refusals.set("asn_stage", [overlap]);
    expect(await convergencePathConflictHolds("/repo", dependency, NOW)).toBe(true);
  });

  it("judges only the stage's unfinished write assignments", async () => {
    workforce.assignments = [
      assignment("asn_done", { status: "completed" }),
      assignment("asn_reader", { accessMode: "read_only" }),
      assignment("asn_elsewhere", {
        convergence: { obligationId: OBLIGATION, stage: "canonical_integration" },
      }),
      assignment("asn_stage"),
    ];
    for (const id of ["asn_done", "asn_reader", "asn_elsewhere"])
      workforce.refusals.set(id, [overlap]);
    expect(await convergencePathConflictHolds("/repo", dependency, NOW)).toBe(false);
    expect(workforce.judged).toEqual(["asn_stage"]);
  });

  it("keeps the broad hold when the failure names no assignment it can find", async () => {
    workforce.assignments = [unrelatedLease];
    // A failure recorded before stages named themselves.
    expect(await convergencePathConflictHolds("/repo", {}, NOW)).toBe(true);
    expect(await convergencePathConflictHolds("/repo", dependency, NOW)).toBe(true);
    workforce.assignments = [{ ...unrelatedLease, accessMode: "read_only" }];
    expect(await convergencePathConflictHolds("/repo", {}, NOW)).toBe(false);
    expect(workforce.judged).toEqual([]);
  });
});
