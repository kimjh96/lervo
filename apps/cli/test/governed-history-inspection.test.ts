import { normalizeGovernedLoopPolicy } from "@lervo/application-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope } from "@lervo/schemas";
import {
  completionEvidenceId,
  projectGovernedWorkReport,
  projectManagedAttempts,
  projectWorkGraphV2,
} from "@lervo/work-controller";
import { afterEach, describe, expect, it, vi } from "vitest";

import { longHistoryEvents } from "../../../packages/storage-contract/test/listed-event-source.fixture.js";
import {
  assignment,
  causalityPayload,
  event,
  projectId,
  workstreamId,
} from "../../../packages/work-controller/test/fixtures.js";

const ports = vi.hoisted(() => ({
  storage: null as unknown,
  assignments: [] as unknown[],
}));
vi.mock("@lervo/project-storage", async (original) => ({
  ...(await original<typeof import("@lervo/project-storage")>()),
  openProjectStorage: async () => ports.storage,
}));
vi.mock("@lervo/agent-workforce", async (original) => ({
  ...(await original<typeof import("@lervo/agent-workforce")>()),
  listAssignments: async () => ports.assignments,
}));
vi.mock("../src/workstream-services.js", () => ({
  verifiedCurrentWorkstream: async () => ({
    workstreamId,
    revision: 3,
    status: "active",
    title: "Long history",
    objective: "Inspect governed work beyond 100,000 events.",
    nextActions: [],
    blockers: [],
    updatedAt: "2026-09-01T00:00:00.000Z",
  }),
}));

const { inspectOperatingGoal } = await import("../src/operating-goal-inspection.js");
const { inspectGovernedWork } = await import("../src/governed-work-inspection.js");
const { loadAssignmentTopologySnapshot } = await import("../src/assignment-topology-inspection.js");
const { recordGovernedCompletionEvidence } = await import("../src/governed-completion-evidence.js");

const node = assignment("1", { status: "leased" });
const runId = "run_111111111111111111111111";
const resultArtifactId = `art_${"a".repeat(64)}`;
const resultContentHash = `sha256:${"e".repeat(64)}`;
const observedAt = new Date("2026-09-01T01:00:00.000Z");

function governedHistory(): EventEnvelope[] {
  return [
    event(
      1,
      "work.causality.recorded",
      runId,
      causalityPayload({ assignmentId: node.assignmentId }),
    ),
    event(2, "run.requested", runId, {}),
    event(3, "adapter.started", runId, {}, "codex"),
    event(4, "run.completed", runId, {
      resultDigest: resultContentHash,
      artifactIds: [resultArtifactId],
      verificationStatus: "passed",
    }),
  ];
}

function useLongHistory(source: readonly EventEnvelope[]) {
  const long = longHistoryEvents(source);
  const appended: unknown[] = [];
  ports.assignments = [node];
  ports.storage = {
    manifest: { projectId },
    paths: { repositoryRoot: "/repository" },
    events: {
      list: long.list,
      latest: () => long.head,
      get: () => null,
      append: (draft: unknown) => appended.push(draft),
    },
    close: async () => undefined,
  };
  return { events: long.events, appended, storage: ports.storage as ProjectStorage };
}

afterEach(() => {
  ports.storage = null;
  ports.assignments = [];
});

describe("governed inspections over long history", () => {
  it("projects governed work and its goal beyond 100,000 events from typed reads", async () => {
    const { events } = useLongHistory(governedHistory());
    const report = await inspectGovernedWork({ repositoryRoot: "/repository", observedAt });
    expect(report).toEqual(
      projectGovernedWorkReport({
        query: {
          schemaVersion: 1,
          kind: "governed_work.inspect",
          projectId,
          workstreamId,
          observedAt: observedAt.toISOString(),
          policy: normalizeGovernedLoopPolicy(),
        },
        assignments: [node],
        events,
      }),
    );
    expect(report.attempts).toMatchObject([{ runId, terminalStatus: "completed" }]);

    const goal = await inspectOperatingGoal({ repositoryRoot: "/repository", observedAt });
    expect(goal).toMatchObject({
      goal: { goalId: workstreamId },
      hierarchy: { graph: report.graph },
      progress: { total: 1 },
    });
  });

  it("projects assignment topology beyond 100,000 events from typed reads", async () => {
    const { events, storage } = useLongHistory(governedHistory());
    const snapshot = await loadAssignmentTopologySnapshot(storage);
    const attempts = projectManagedAttempts({ events, workstreamId }).attempts;
    expect(attempts).toHaveLength(1);
    expect({ ...snapshot.graph, observedAt: "" }).toEqual({
      ...projectWorkGraphV2({
        projectId,
        workstreamId,
        assignments: [node],
        attempts,
        events,
        observedAt: snapshot.graph.observedAt,
      }),
      observedAt: "",
    });
  });

  it("records completion evidence beyond 100,000 events and still rejects a mismatch", () => {
    const { appended, storage } = useLongHistory(governedHistory());
    const input = {
      storage,
      workstreamId,
      assignmentId: node.assignmentId,
      assignmentRevision: 2,
      agentId: "agt_111111111111111111111111",
      leaseId: "lse_111111111111111111111111",
      runId,
      sessionId: governedHistory()[3]!.sessionId,
      resultArtifactId,
      resultContentHash,
      preparedAt: "2026-09-01T00:00:09.000Z",
    };
    const { storage: _storage, ...coordinate } = input;
    expect(recordGovernedCompletionEvidence(input)).toBe(completionEvidenceId(coordinate));
    expect(appended).toHaveLength(1);

    expect(() =>
      recordGovernedCompletionEvidence({ ...input, resultContentHash: `sha256:${"0".repeat(64)}` }),
    ).toThrowError("differs from canonical managed-run history");
  });
});
