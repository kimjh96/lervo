import { describe, expect, it } from "vitest";

import type { HostedLaunchRecord } from "../src/hosted-launch-records.js";
import {
  retireHostedWorkspace,
  type WorkspaceRetireEffects,
} from "../src/hosted-workspace-retire.js";

const launch: HostedLaunchRecord = {
  schemaVersion: 1,
  workspaceId: "wsp_a",
  sessionId: "session-a",
  provider: "claude",
  projectId: "prj_1",
  branch: "lervo/fix-the-build-1a2b3c",
  conversationMode: "native",
  argumentDigest: "sha256:x",
  settingsDigest: null,
  mcpConfigDigest: null,
  preparedAt: "2026-11-24T00:00:00Z",
};

/** Fake effects that record each change; `state` sets what the checks report. */
function effects(state: {
  launch?: HostedLaunchRecord | null;
  worktree?: string | null;
  inUse?: boolean;
  changes?: boolean;
  branch?: boolean;
  merged?: boolean;
  /** The conversation's refusal before anything is removed, such as a pending integration. */
  pending?: boolean;
  /** The worktree the conversation's record names, when no worktree has the branch. */
  conversationWorktree?: string;
}) {
  const changes: string[] = [];
  const port: WorkspaceRetireEffects = {
    latestLaunch: async () => (state.launch === undefined ? launch : state.launch),
    sessionsOf: async () => ["session-a", "session-b"],
    repositoryRoot: async (projectId) => (projectId === "prj_1" ? "/repo" : null),
    worktreeOf: async () => (state.worktree === undefined ? "/repo-wt/fix" : state.worktree),
    inUse: async () => state.inUse ?? false,
    hasChanges: async () => state.changes ?? false,
    removeWorktree: async (_root, worktree) => void changes.push(`worktree ${worktree}`),
    branchExists: async () => state.branch ?? true,
    branchMerged: async () => state.merged ?? true,
    deleteBranch: async (_root, branch) => void changes.push(`branch ${branch}`),
    removeSessionSettings: async (ids) => void changes.push(`settings ${ids.join(",")}`),
    conversation: {
      assertRetirable: async () => {
        if (state.pending === true)
          throw Object.assign(new Error("pending"), { code: "workspace_integration_pending" });
      },
      worktreeOf: async () => state.conversationWorktree ?? null,
      retire: async (_root, conversationId) => void changes.push(`conversation ${conversationId}`),
    },
  };
  return { port, changes };
}

describe("retiring a hosted workspace", () => {
  it("removes the clean worktree, the merged branch, and every session's settings", async () => {
    const { port, changes } = effects({});
    await expect(retireHostedWorkspace("wsp_a", port)).resolves.toEqual({
      workspaceId: "wsp_a",
      worktree: "removed",
      branch: "deleted",
    });
    expect(changes).toEqual([
      "worktree /repo-wt/fix",
      "conversation wsp_a",
      "branch lervo/fix-the-build-1a2b3c",
      "settings session-a,session-b",
    ]);
  });

  it("keeps a branch with commits the default branch lacks, or one Lervo did not create", async () => {
    const unmerged = effects({ merged: false });
    await expect(retireHostedWorkspace("wsp_a", unmerged.port)).resolves.toMatchObject({
      branch: "kept",
    });
    expect(unmerged.changes.some((change) => change.startsWith("branch"))).toBe(false);
    const foreign = effects({ launch: { ...launch, branch: "main" } });
    await expect(retireHostedWorkspace("wsp_a", foreign.port)).resolves.toMatchObject({
      branch: "kept",
    });
    expect(foreign.changes.some((change) => change.startsWith("branch"))).toBe(false);
  });

  it("refuses, changing nothing, while a process runs in it or it holds changes", async () => {
    for (const [state, code] of [
      [{ inUse: true }, "workspace_in_use"],
      [{ changes: true }, "workspace_has_changes"],
      [{ pending: true }, "workspace_integration_pending"],
    ] as const) {
      const { port, changes } = effects(state);
      await expect(retireHostedWorkspace("wsp_a", port)).rejects.toMatchObject({ code });
      expect(changes).toEqual([]);
    }
  });

  it("finishes an earlier retirement when the worktree is already gone", async () => {
    const { port, changes } = effects({ worktree: null, branch: false });
    await expect(retireHostedWorkspace("wsp_a", port)).resolves.toEqual({
      workspaceId: "wsp_a",
      worktree: "absent",
      branch: "absent",
    });
    expect(changes).toEqual(["conversation wsp_a", "settings session-a,session-b"]);
  });

  it("finds a conversation's worktree by its record when its branch moved", async () => {
    const { port, changes } = effects({ worktree: null, conversationWorktree: "/repo-wt/moved" });
    await expect(retireHostedWorkspace("wsp_a", port)).resolves.toMatchObject({
      worktree: "removed",
    });
    expect(changes.slice(0, 2)).toEqual(["worktree /repo-wt/moved", "conversation wsp_a"]);
  });

  it("knows no workspace without a launch record or a registered repository", async () => {
    for (const state of [{ launch: null }, { launch: { ...launch, projectId: "prj_gone" } }]) {
      const { port } = effects(state);
      await expect(retireHostedWorkspace("wsp_a", port)).rejects.toMatchObject({
        code: "workspace_not_found",
      });
    }
  });
});
