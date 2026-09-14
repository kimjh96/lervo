import { describe, expect, it } from "vitest";

import {
  isWorkstreamSuccessorRoot,
  validateSchema,
  type WorkstreamSnapshot,
} from "../src/index.js";

const first: WorkstreamSnapshot = {
  schemaVersion: 1,
  workstreamId: "wks_0123456789abcdef01234567",
  revision: 1,
  status: "active",
  title: "Next goal",
  objective: "Bind a separate human request.",
  nextActions: [],
  blockers: [],
  notes: [],
  references: [],
  pendingDecisions: [],
  pendingApprovals: [],
  origin: {
    kind: "successor",
    sourceArtifactId: null,
    sourceContentHash: null,
    sourcePathDigest: null,
    predecessorWorkstreamId: "wks_abcdefabcdefabcdefabcdef",
    predecessorSnapshotContentHash: `sha256:${"a".repeat(64)}`,
  },
  updatedAt: "2026-09-14T04:00:00.000Z",
};

describe("successor workstream origin", () => {
  it("requires a complete predecessor and rejects unexplained predecessor fields", () => {
    expect(validateSchema("workstreamSnapshot", first).valid).toBe(true);
    expect(
      validateSchema("workstreamSnapshot", {
        ...first,
        origin: { ...first.origin, predecessorSnapshotContentHash: undefined },
      }).valid,
    ).toBe(false);
    expect(
      validateSchema("workstreamSnapshot", {
        ...first,
        origin: { ...first.origin, kind: "created" },
      }).valid,
    ).toBe(false);
  });

  it("does not treat an active predecessor as a completed goal", () => {
    const predecessor = {
      ...first,
      workstreamId: "wks_abcdefabcdefabcdefabcdef",
      snapshotContentHash: `sha256:${"a".repeat(64)}`,
      status: "active" as const,
      origin: {
        kind: "created" as const,
        sourceArtifactId: null,
        sourceContentHash: null,
        sourcePathDigest: null,
      },
    };
    expect(isWorkstreamSuccessorRoot(first, predecessor)).toBe(false);
    expect(isWorkstreamSuccessorRoot(first, { ...predecessor, status: "completed" })).toBe(true);
    expect(
      isWorkstreamSuccessorRoot(
        { ...first, workstreamId: predecessor.workstreamId },
        { ...predecessor, status: "completed" },
      ),
    ).toBe(false);
  });
});
