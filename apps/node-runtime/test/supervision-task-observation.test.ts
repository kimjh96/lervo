import { describe, expect, it } from "vitest";
import type { SupervisedAssignmentObservationV1 } from "@lervo/application-contract";
import {
  observeSupervisionTasks,
  replacedReworkAssignments,
} from "../src/supervision-task-observation.js";

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
    expect(observed).toEqual({
      assignments: [],
      unboundAssignmentIds: [`asn_${"b".repeat(24)}`],
      replacedAssignmentIds: [],
    });
  });
  it("settles a rework rejection once a later assignment replaces it", () => {
    const rejected = `asn_${"a".repeat(24)}`;
    const replacement = `asn_${"b".repeat(24)}`;
    const earlier = `asn_${"c".repeat(24)}`;
    const created = (assignmentId: string, seq: number) => ({
      type: "assignment.created",
      seq,
      payload: { assignmentId },
    });
    const observation = (assignmentId: string, verdict: "rework" | "accepted") =>
      ({ assignmentId, review: { verdict } }) as unknown as SupervisedAssignmentObservationV1;
    const source = (replacementStatus: string) =>
      ({
        assignments: [
          { assignmentId: rejected, status: "completed" },
          { assignmentId: replacement, status: replacementStatus },
          { assignmentId: earlier, status: "completed" },
        ],
        events: [created(earlier, 1), created(rejected, 2), created(replacement, 9)],
      }) as unknown as Source;
    const observed = [observation(rejected, "rework"), observation(earlier, "accepted")];
    // The rejection review was recorded at seq 5; the replacement was created at seq 9.
    const reviews = new Map([[rejected, 5]]);
    expect(replacedReworkAssignments(source("leased"), observed, reviews)).toEqual([rejected]);
    // A cancelled replacement replaces nothing, and work created before the rejection is separate.
    expect(replacedReworkAssignments(source("cancelled"), observed, reviews)).toEqual([]);
    expect(
      replacedReworkAssignments(source("leased"), observed, new Map([[rejected, 10]])),
    ).toEqual([]);
  });
});
