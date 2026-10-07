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
  it("binds an explicit reconciliation to either exact active predecessor without settling it", () => {
    const left = {
      ...first,
      workstreamId: "wks_abcdefabcdefabcdefabcdef",
      snapshotContentHash: `sha256:${"a".repeat(64)}`,
    };
    const right = { ...left, snapshotContentHash: `sha256:${"b".repeat(64)}` };
    const reconciled = {
      ...first,
      origin: {
        ...first.origin,
        reconciliationPredecessors: [
          { workstreamId: left.workstreamId, snapshotContentHash: left.snapshotContentHash },
          { workstreamId: right.workstreamId, snapshotContentHash: right.snapshotContentHash },
        ],
      },
    };
    expect(validateSchema("workstreamSnapshot", reconciled).valid).toBe(true);
    expect(isWorkstreamSuccessorRoot(reconciled, left)).toBe(true);
    expect(isWorkstreamSuccessorRoot(reconciled, right)).toBe(true);
    expect(
      isWorkstreamSuccessorRoot(reconciled, {
        ...right,
        snapshotContentHash: `sha256:${"c".repeat(64)}`,
      }),
    ).toBe(false);
    const malformed = {
      ...reconciled,
      origin: { ...reconciled.origin, predecessorSnapshotContentHash: `sha256:${"c".repeat(64)}` },
    };
    expect(isWorkstreamSuccessorRoot(malformed, left)).toBe(false);
    expect(isWorkstreamSuccessorRoot({ ...reconciled, revision: 2 }, left)).toBe(false);
  });
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

  it("succeeds a settled completed or cancelled predecessor and rejects the rest", () => {
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
    // Standing supervision opens the next goal after an honest cancellation, so a settled
    // cancelled head links a successor exactly like a completed one; an unsettled one does not.
    expect(isWorkstreamSuccessorRoot(first, { ...predecessor, status: "cancelled" })).toBe(true);
    expect(
      isWorkstreamSuccessorRoot(first, {
        ...predecessor,
        status: "cancelled",
        blockers: ["The cancelled worker attempt is unreconciled."],
      }),
    ).toBe(false);
    expect(isWorkstreamSuccessorRoot(first, { ...predecessor, status: "blocked" })).toBe(false);
  });
});
