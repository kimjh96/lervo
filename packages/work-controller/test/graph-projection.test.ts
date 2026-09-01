import { describe, expect, it } from "vitest";

import { projectWorkGraph } from "../src/index.js";
import { assignment, projectId, workstreamId } from "./fixtures.js";

describe("work graph projection", () => {
  it("projects parallel roots and one join without creating graph authority", () => {
    const left = assignment("1");
    const right = assignment("2");
    const join = assignment("3", { dependencyIds: [left.assignmentId, right.assignmentId] });
    const graph = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [join, right, left],
      attempts: [],
      observedAt: "2026-09-01T00:01:00.000Z",
    });

    expect(graph.validity).toEqual({ status: "valid", reasonCodes: [] });
    expect(graph.rootAssignmentIds).toEqual([left.assignmentId, right.assignmentId]);
    expect(graph.joinAssignmentIds).toEqual([join.assignmentId]);
    expect(graph.graphHash).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("keeps the state hash stable across observation time until lease state changes", () => {
    const node = assignment("1", {
      status: "leased",
      assigneeAgentId: "agt_111111111111111111111111",
      lease: {
        leaseId: "lse_111111111111111111111111",
        agentId: "agt_111111111111111111111111",
        sessionId: "ses_111111111111111111111111",
        generation: 1,
        acquiredAt: "2026-09-01T00:00:00.000Z",
        expiresAt: "2026-09-01T00:05:00.000Z",
      },
    });
    const before = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [node],
      attempts: [],
      observedAt: "2026-09-01T00:01:00.000Z",
    });
    const stillCurrent = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [node],
      attempts: [],
      observedAt: "2026-09-01T00:02:00.000Z",
    });
    const expired = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [node],
      attempts: [],
      observedAt: "2026-09-01T00:06:00.000Z",
    });

    expect(stillCurrent.graphHash).toBe(before.graphHash);
    expect(expired.graphHash).not.toBe(before.graphHash);
  });

  it("keeps a dependency outside the workstream explicit and invalid", () => {
    const outside = assignment("8", { workstreamId: "wks_222222222222222222222222" });
    const inside = assignment("9", { dependencyIds: [outside.assignmentId] });
    const graph = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [outside, inside],
      attempts: [],
      observedAt: "2026-09-01T00:01:00.000Z",
    });
    expect(graph.validity).toEqual({ status: "invalid", reasonCodes: ["dependency_escape"] });
  });

  it("invalidates an attempt whose assignment is absent from the current graph", () => {
    const graph = projectWorkGraph({
      projectId,
      workstreamId,
      assignments: [assignment("1")],
      attempts: [
        {
          schemaVersion: 1,
          assignmentId: assignment("2").assignmentId,
          workId: "wrk_111111111111111111111111",
          runId: "run_111111111111111111111111",
          relationship: "root",
          attemptOrdinal: 1,
          terminalStatus: "failed",
          verificationStatus: "unavailable",
        },
      ],
      observedAt: "2026-09-01T00:01:00.000Z",
    });

    expect(graph.validity.reasonCodes).toEqual(["attempt_assignment_escape"]);
  });
});
