import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { createAssignment, registerAgent, type WorkforceAssignment } from "@lervo/agent-workforce";
import { applyInitPlan, createInitPlan } from "@lervo/project";
import { afterEach, describe, expect, it } from "vitest";

import {
  claimWorkspaceAssignment,
  workspaceCoordinationHealth,
  workspaceReservationScopes,
  type WorkspaceReservationClaim,
  type WorkspaceReservationPort,
} from "../src/index.js";

const roots: string[] = [];

async function fixture(expectedPaths = ["packages/worker"]) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-workspace-claim-"));
  roots.push(root);
  await applyInitPlan(
    await createInitPlan({
      root,
      projectId: "prj_workspace_claim",
      now: new Date("2026-08-26T00:00:00Z"),
    }),
  );
  const agent = await registerAgent({
    repositoryRoot: root,
    roleId: "developer",
    provider: "codex",
    responsibilityPaths: ["*"],
    now: new Date("2026-08-26T00:00:01Z"),
  });
  const assignment = await createAssignment({
    repositoryRoot: root,
    taskType: "implementation",
    roleId: "developer",
    acceptanceCriteria: ["Complete the bounded assignment."],
    verificationSuiteIds: ["project.quick"],
    expectedPaths,
    now: new Date("2026-08-26T00:00:02Z"),
  });
  return { root, agent, assignment };
}

class RecordingReservationPort implements WorkspaceReservationPort {
  readonly calls: Array<
    { kind: "reserve"; request: WorkspaceReservationClaim } | { kind: "release" }
  > = [];

  async reserve(request: WorkspaceReservationClaim) {
    this.calls.push({ kind: "reserve", request });
    return {
      status: "granted" as const,
      reservationId: request.reservationId,
      expiresAt: request.expiresAt,
    };
  }

  async release(): Promise<void> {
    this.calls.push({ kind: "release" });
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace assignment coordination", () => {
  it("keeps local-first claims fully independent from Hub", async () => {
    const current = await fixture();
    const port = new RecordingReservationPort();
    const claimed = await claimWorkspaceAssignment({
      repositoryRoot: current.root,
      assignmentId: current.assignment.assignmentId,
      agentId: current.agent.agentId,
      sessionId: "ses_local_first_claim",
      mode: "local_first",
      reservationPort: port,
      now: new Date("2026-08-26T00:00:03Z"),
    });
    expect(claimed).toMatchObject({
      coordinationMode: "local_first",
      reservation: null,
      assignment: { status: "leased" },
    });
    expect(claimed.workspaceId).toMatch(/^wsp_[a-f0-9]{24}$/u);
    expect(port.calls).toEqual([]);
  });

  it("obtains a path-private Hub reservation before the local lease", async () => {
    const current = await fixture(["packages/worker/src", "docs"]);
    const port = new RecordingReservationPort();
    const claimed = await claimWorkspaceAssignment({
      repositoryRoot: current.root,
      assignmentId: current.assignment.assignmentId,
      agentId: current.agent.agentId,
      sessionId: "ses_hub_coordinated_claim",
      mode: "hub_coordinated",
      nodeId: "nod_workspace_claim_01",
      repositoryIdentityHash: `sha256:${"a".repeat(64)}`,
      baseCommit: "b".repeat(40),
      integrationTargetDigest: `sha256:${"c".repeat(64)}`,
      reservationPort: port,
      now: new Date("2026-08-26T00:00:03Z"),
    });
    expect(port.calls[0]).toMatchObject({
      kind: "reserve",
      request: {
        assignmentId: current.assignment.assignmentId,
        workspaceId: claimed.workspaceId,
        generation: 1,
      },
    });
    expect(JSON.stringify(port.calls[0])).not.toContain("packages/worker/src");
    expect(JSON.stringify(port.calls[0])).not.toContain("docs");
    expect(claimed).toMatchObject({
      coordinationMode: "hub_coordinated",
      reservation: { reservationId: expect.stringMatching(/^hrs_[a-f0-9]{24}$/u) },
      assignment: { status: "leased" },
    });
  });

  it("releases a granted Hub reservation when the local path lease loses the race", async () => {
    const first = await fixture(["packages/shared"]);
    const secondAssignment: WorkforceAssignment = await createAssignment({
      repositoryRoot: first.root,
      taskType: "implementation.second",
      roleId: "developer",
      acceptanceCriteria: ["Do not overlap."],
      verificationSuiteIds: ["project.quick"],
      expectedPaths: ["packages/shared"],
      now: new Date("2026-08-26T00:00:03Z"),
    });
    await claimWorkspaceAssignment({
      repositoryRoot: first.root,
      assignmentId: first.assignment.assignmentId,
      agentId: first.agent.agentId,
      sessionId: "ses_first_path_claim",
      mode: "local_first",
      now: new Date("2026-08-26T00:00:04Z"),
    });
    const port = new RecordingReservationPort();
    await expect(
      claimWorkspaceAssignment({
        repositoryRoot: first.root,
        assignmentId: secondAssignment.assignmentId,
        agentId: first.agent.agentId,
        sessionId: "ses_second_path_claim",
        mode: "hub_coordinated",
        nodeId: "nod_workspace_claim_01",
        repositoryIdentityHash: `sha256:${"a".repeat(64)}`,
        baseCommit: "b".repeat(40),
        integrationTargetDigest: `sha256:${"c".repeat(64)}`,
        reservationPort: port,
        now: new Date("2026-08-26T00:00:05Z"),
      }),
    ).rejects.toMatchObject({ code: "assignment_path_conflict" });
    expect(port.calls.map((call) => call.kind)).toEqual(["reserve", "release"]);
  });

  it("reports workspace coordination health independently from local execution", () => {
    expect(workspaceCoordinationHealth({ mode: "local_first", hubReachable: false })).toBe(
      "disabled",
    );
    expect(
      workspaceCoordinationHealth({
        mode: "hub_coordinated",
        hubReachable: true,
        reservationStatus: "granted",
        reservationGeneration: 2,
        localLeaseGeneration: 1,
        reservationExpiresAt: "2026-08-26T00:10:00Z",
        now: new Date("2026-08-26T00:00:00Z"),
      }),
    ).toBe("stale_generation");
    expect(
      workspaceCoordinationHealth({
        mode: "hub_coordinated",
        hubReachable: true,
        reservationStatus: "granted",
        reservationGeneration: 1,
        localLeaseGeneration: 1,
        reservationExpiresAt: "2026-08-26T00:10:00Z",
        now: new Date("2026-08-26T00:00:00Z"),
      }),
    ).toBe("ready");
    expect(workspaceReservationScopes(["packages/app"])).toHaveLength(1);
  });
});
