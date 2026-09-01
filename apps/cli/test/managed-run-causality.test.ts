import { describe, expect, it } from "vitest";
import type { WorkstreamSnapshot } from "@lervo/schemas";

import { resolveManagedRunCausality } from "../src/managed-run-causality.js";

const workstream: WorkstreamSnapshot = {
  schemaVersion: 1,
  workstreamId: "wks_111111111111111111111111",
  revision: 1,
  status: "active",
  title: "Current work",
  objective: "Complete the bounded work.",
  nextActions: [],
  blockers: [],
  notes: [],
  references: [],
  origin: {
    kind: "created",
    sourceArtifactId: null,
    sourceContentHash: null,
    sourcePathDigest: null,
  },
  updatedAt: "2026-09-01T00:00:00.000Z",
};

describe("managed run causality", () => {
  it("binds ordinary workforce runs to assignment and agent authority", () => {
    expect(
      resolveManagedRunCausality({
        currentWorkstream: workstream,
        workforce: {
          assignmentId: "asn_111111111111111111111111",
          agentId: "agt_111111111111111111111111",
          leaseId: "lse_111111111111111111111111",
        },
      }),
    ).toMatchObject({
      relationship: "root",
      workstreamId: workstream.workstreamId,
      assignmentId: "asn_111111111111111111111111",
      agentId: "agt_111111111111111111111111",
    });
  });

  it("rejects caller-authored retry coordinates outside workforce authority", () => {
    expect(() =>
      resolveManagedRunCausality({
        currentWorkstream: workstream,
        requested: {
          relationship: "retry",
          workId: "wrk_111111111111111111111111",
          parentRunId: "run_111111111111111111111111",
          retryOfRunId: "run_111111111111111111111111",
          attemptOrdinal: 2,
          workstreamId: workstream.workstreamId,
        },
      }),
    ).toThrow("requires exact workforce authority");
  });
});
