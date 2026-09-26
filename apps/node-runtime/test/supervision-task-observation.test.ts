import { describe, expect, it } from "vitest";
import { observeSupervisionTasks } from "../src/supervision-task-observation.js";

type Source = Parameters<typeof observeSupervisionTasks>[0];

describe("supervised task observation", () => {
  it("never reports a cancelled assignment as a responsibility left to install", async () => {
    const assignment = (assignmentId: string, status: string) => ({
      assignmentId,
      status,
      revision: 3,
      lease: null,
    });
    const source = {
      workstream: { status: "active" },
      assignments: [
        assignment(`asn_${"a".repeat(24)}`, "cancelled"),
        assignment(`asn_${"b".repeat(24)}`, "queued"),
      ],
      responsibilities: [],
      execution: { attempts: [] },
      events: [],
      supervisionEvents: [],
    } as unknown as Source;
    const observed = await observeSupervisionTasks(
      source,
      {} as Parameters<typeof observeSupervisionTasks>[1],
      {
        supervisionId: "supervision.project",
        workstreamId: `wks_${"a".repeat(24)}`,
        ownerAgentId: `agt_${"a".repeat(24)}`,
        mandateHash: `sha256:${"a".repeat(64)}`,
      },
      {} as Parameters<typeof observeSupervisionTasks>[3],
    );
    expect(observed).toEqual({ assignments: [], unboundAssignmentIds: [`asn_${"b".repeat(24)}`] });
  });
});
