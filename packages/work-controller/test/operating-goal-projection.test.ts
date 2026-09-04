import type { OperatingObjectiveReportV1, WorkGraphV1 } from "@lervo/application-contract";
import { describe, expect, it } from "vitest";

import { projectOperatingGoalReport } from "../src/operating-goal-projection.js";

const workstreamId = "wks_goal_projection_fixture";

function objective(status: OperatingObjectiveReportV1["status"] = "active") {
  return {
    schemaVersion: 1 as const,
    projectId: "prj_goal_projection",
    workstreamId,
    workstreamRevision: 3,
    status,
    title: "Verified goal",
    objective: "Complete the bounded assignment graph.",
    nextActions: ["Complete the active assignment."],
    blockers: [],
    pendingDecisions: [],
    pendingApprovals: [],
    updatedAt: "2026-09-04T00:00:00.000Z",
    observedAt: "2026-09-04T00:01:00.000Z",
  } satisfies OperatingObjectiveReportV1;
}

function graph(status: WorkGraphV1["nodes"][number]["status"] = "leased"): WorkGraphV1 {
  return {
    schemaVersion: 1,
    graphId: "wgr_goal_projection_fixture",
    graphHash: `sha256:${"a".repeat(64)}`,
    projectId: "prj_goal_projection",
    workstreamId,
    observedAt: "2026-09-04T00:01:00.000Z",
    validity: { status: "valid", reasonCodes: [] },
    nodes: [
      {
        assignmentId: "asn_goal_projection_fixture",
        assignmentRevision: 2,
        taskType: "implementation",
        roleId: "developer",
        status,
        priority: 50,
        dependencyIds: [],
        approvalRequirementDigests: [],
        leaseState: status === "leased" ? "active" : "none",
        assigneeAgentId: status === "leased" ? "agt_goal_projection_fixture" : null,
        leaseId: status === "leased" ? "lse_goal_projection_fixture" : null,
        attemptCount: 1,
      },
    ],
    rootAssignmentIds: ["asn_goal_projection_fixture"],
    joinAssignmentIds: [],
  };
}

describe("operating goal projection", () => {
  it("composes the workstream authority and assignment DAG without creating authority", () => {
    const report = projectOperatingGoalReport({ objective: objective(), graph: graph() });

    expect(report).toMatchObject({
      kind: "operating_goal.report",
      goal: { goalId: workstreamId, authoritySource: "workstream", status: "active" },
      hierarchy: { kind: "workstream_assignment_dag" },
      progress: { total: 1, active: 1, completed: 0 },
      completion: { status: "active", reasonCodes: [] },
      authority: {
        createsGoal: false,
        changesWorkstream: false,
        changesAssignments: false,
        startsProvider: false,
      },
    });
  });

  it("marks explicit completion inconsistent while assignments remain unresolved", () => {
    const report = projectOperatingGoalReport({
      objective: objective("completed"),
      graph: graph("leased"),
    });

    expect(report.completion).toEqual({
      status: "inconsistent",
      reasonCodes: ["completed_workstream_has_unresolved_assignments"],
    });
  });

  it("requires the objective and graph to share one canonical coordinate", () => {
    const mismatched = graph();
    mismatched.workstreamId = "wks_other_goal";

    expect(() => projectOperatingGoalReport({ objective: objective(), graph: mismatched })).toThrow(
      "do not share one authority coordinate",
    );
  });
});
