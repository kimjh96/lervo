import { rm } from "node:fs/promises";
import { afterEach, expect, it, vi } from "vitest";
import * as workforce from "@lervo/agent-workforce";
import * as retention from "../src/supervision-unstarted-workspace.js";
import { currentSupervisionWorkspaces } from "../src/supervision-workspace-generations.js";
import { dispatchFixture } from "./supervision-dispatch.fixture.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

it.each([false, true])(
  "bounds predecessor reads and settles the full batch on failure: %s",
  async (fail) => {
    const f = await dispatchFixture(roots);
    const original = (await workforce.readWorkspace(f.root, f.provision.workspace.workspaceId))!
      .workspace;
    const previous = Array.from({ length: 9 }, (_, index) => ({
      ...original,
      workspaceId: `wsp_previous_${index}`,
      leaseGeneration: index + 1,
    }));
    const current = { ...original, leaseGeneration: 10 };
    const assignment = { ...f.assignment, lease: { ...f.assignment.lease!, generation: 10 } };
    vi.spyOn(workforce, "listWorkspaces").mockResolvedValue([...previous, current]);
    const release: Array<() => void> = [];
    const entered: string[] = [];
    const settled: string[] = [];
    vi.spyOn(retention, "observeUnstartedSupervisionWorkspace").mockImplementation(
      async ({ workspace }) => {
        entered.push(workspace.workspaceId);
        await new Promise<void>((resolve) => release.push(resolve));
        settled.push(workspace.workspaceId);
        if (fail && workspace.workspaceId === previous[0]!.workspaceId) return null;
        return {
          workspaceId: workspace.workspaceId,
          assignmentId: assignment.assignmentId,
          leaseGeneration: workspace.leaseGeneration,
          evidenceHash: "sha256:" + "1".repeat(64),
        };
      },
    );
    let finished = false;
    const result = currentSupervisionWorkspaces(f.root, assignment, f.binding).then(
      (value) => {
        finished = true;
        return { value, error: null };
      },
      (error: unknown) => {
        finished = true;
        return { value: null, error };
      },
    );
    await vi.waitFor(() => expect(entered).toHaveLength(4));
    release.shift()!();
    await vi.waitFor(() => expect(settled).toHaveLength(1));
    expect(finished).toBe(false);
    expect(entered).toHaveLength(4);
    release.splice(0).forEach((resolve) => resolve());
    if (fail) {
      expect((await result).error).toBeInstanceOf(Error);
      expect(entered).toHaveLength(4);
      expect(settled).toHaveLength(4);
    } else {
      await vi.waitFor(() => expect(entered).toHaveLength(8));
      release.splice(0).forEach((resolve) => resolve());
      await vi.waitFor(() => expect(entered).toHaveLength(9));
      release.splice(0).forEach((resolve) => resolve());
      expect(await result).toEqual({ value: [current], error: null });
      expect(settled).toEqual(previous.map((workspace) => workspace.workspaceId));
    }
  },
  15000,
);
