import { afterEach, expect, it, vi } from "vitest";
import type { AgentWorkspace, WorkforceAssignment } from "@lervo/agent-workforce";
import * as retention from "../src/supervision-unstarted-workspace.js";
import { observeUnstartedSupervisionWorkspaces } from "../src/supervision-unstarted-workspaces.js";

afterEach(() => {
  vi.restoreAllMocks();
});

it("observes retained workspaces four at a time and keeps input order", async () => {
  const candidates = Array.from({ length: 9 }, (_, index) => ({
    assignment: { assignmentId: `asg_${index}` } as WorkforceAssignment,
    workspace: { workspaceId: `wsp_${index}` } as AgentWorkspace,
  }));
  const release = new Map<string, () => void>();
  let active = 0;
  let peak = 0;
  vi.spyOn(retention, "observeUnstartedSupervisionWorkspace").mockImplementation(
    async ({ assignment, workspace }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => release.set(workspace.workspaceId, resolve));
      active -= 1;
      // An observation that cannot prove a never-used checkout contributes no fact.
      return workspace.workspaceId === "wsp_4"
        ? null
        : {
            assignmentId: assignment.assignmentId,
            workspaceId: workspace.workspaceId,
            leaseGeneration: 1,
            evidenceHash: `sha256:${"1".repeat(64)}`,
          };
    },
  );
  const result = observeUnstartedSupervisionWorkspaces({
    repositoryRoot: "/repository",
    binding: {
      supervisionId: "supervision.fixture",
      workstreamId: `wks_${"a".repeat(24)}`,
      ownerAgentId: `agt_${"b".repeat(24)}`,
      mandateHash: `sha256:${"c".repeat(64)}`,
    },
    candidates,
  });
  await vi.waitFor(() => expect(release.size).toBe(4));
  // Release out of order; the result still follows the candidate order.
  for (const id of ["wsp_3", "wsp_1", "wsp_2", "wsp_0"]) release.get(id)!();
  await vi.waitFor(() => expect(release.size).toBe(8));
  for (const id of ["wsp_7", "wsp_4", "wsp_6", "wsp_5"]) release.get(id)!();
  await vi.waitFor(() => expect(release.size).toBe(9));
  release.get("wsp_8")!();
  expect((await result).map((proof) => proof.workspaceId)).toEqual([
    "wsp_0",
    "wsp_1",
    "wsp_2",
    "wsp_3",
    "wsp_5",
    "wsp_6",
    "wsp_7",
    "wsp_8",
  ]);
  expect(peak).toBe(4);
});

it("gives every proof over one store a single shared read of its evidence", async () => {
  const candidates = Array.from({ length: 6 }, (_, index) => ({
    assignment: { assignmentId: `asg_${index}` } as WorkforceAssignment,
    workspace: { workspaceId: `wsp_${index}` } as AgentWorkspace,
  }));
  const sources = { head: null, supervisionHistory: [], workspaceEvents: [] };
  const read = vi.spyOn(retention, "readUnstartedWorkspaceSources").mockResolvedValue(sources);
  const observed: unknown[] = [];
  vi.spyOn(retention, "observeUnstartedSupervisionWorkspace").mockImplementation(async (input) => {
    observed.push(await input.sources!(), await input.sources!());
    return null;
  });
  const storage = {} as Parameters<typeof observeUnstartedSupervisionWorkspaces>[0]["storage"];
  await observeUnstartedSupervisionWorkspaces({
    repositoryRoot: "/repository",
    binding: {
      supervisionId: "supervision.fixture",
      workstreamId: `wks_${"a".repeat(24)}`,
      ownerAgentId: `agt_${"b".repeat(24)}`,
      mandateHash: `sha256:${"c".repeat(64)}`,
    },
    storage,
    candidates,
  });
  expect(read).toHaveBeenCalledTimes(1);
  expect(observed).toHaveLength(12);
  expect(observed.every((value) => value === sources)).toBe(true);
});
