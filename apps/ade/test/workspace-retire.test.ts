import type { HostMessage } from "@lervo/session-host-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { retireWorkspace, useKeptChanges } from "../src/features/workspaces/model/retire";
import { useWorkspaceStore } from "../src/features/workspaces/model/store";
import type { Workspace } from "../src/features/workspaces/model/types";
import {
  type ApplicationCommands,
  type ListCache,
  RequestFailure,
  type SessionHost,
} from "../src/ports";

const workspace: Workspace = {
  workspaceId: "wsp_a",
  projectId: "prj_1",
  repositoryName: "web",
  branch: "lervo/fix-the-build-1a2b3c",
  title: "Fix the build",
  provider: "claude",
  conversationMode: "native",
  sessionId: "session-a",
  preparedAt: "2026-11-24T00:00:00Z",
};

/** A session host that answers `session.stop` as `stop` says and reports the session ended. */
function host(stop: "ends" | "not_found" | "hangs") {
  const listeners = new Set<(message: HostMessage) => void>();
  const posted: string[] = [];
  const fake: SessionHost = {
    connection: "connected",
    request: async () => {
      throw new Error("unused");
    },
    async post(message) {
      posted.push(message.kind);
      if (stop === "not_found") throw new RequestFailure("session_not_found");
      const stopped = message.kind === "session.stop" ? message.sessionId : "session-a";
      if (stop === "ends")
        queueMicrotask(() => {
          for (const listener of listeners)
            listener({
              kind: "session.status",
              sessionId: stopped,
              sequence: 9,
              status: "ended",
            });
        });
    },
    send: async () => undefined,
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onState: () => () => undefined,
  };
  return { fake, posted, listeners };
}

/** Commands that answer retire with `retire`, and the lists the core lists afterwards. */
function commands(retire: () => Promise<object>): ApplicationCommands & { ran: string[] } {
  const ran: string[] = [];
  return {
    ran,
    async run(command) {
      ran.push(command);
      if (command === "workspace.retire") return (await retire()) as never;
      if (command === "workspace.list") return { workspaces: [], commands: [] } as never;
      return { repositories: [] } as never;
    },
  };
}

const lists: ListCache = { load: () => null, save: () => undefined };

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [workspace],
    repositories: [],
    statuses: { "session-a": "idle" },
    selected: "wsp_a",
    loaded: true,
  });
});

describe("retiring a workspace from the interface", () => {
  it("stops the running session, waits for its end, removes the workspace, and leaves it", async () => {
    const session = host("ends");
    const core = commands(async () => ({
      workspaceId: "wsp_a",
      worktree: "removed",
      branch: "deleted",
    }));
    const steps: string[] = [];
    await retireWorkspace({
      host: session.fake,
      commands: core,
      lists,
      workspaceId: "wsp_a",
      onStep: (step) => steps.push(step),
    });
    expect(steps).toEqual(["stopping", "removing"]);
    expect(session.posted).toEqual(["session.stop"]);
    expect(core.ran).toEqual(["workspace.retire", "workspace.list", "repository.list"]);
    expect(useWorkspaceStore.getState()).toMatchObject({ selected: null, workspaces: [] });
    expect(session.listeners.size).toBe(0);
  });

  it("stops every agent's session in the conversation, not only the lead's", async () => {
    useWorkspaceStore.setState({
      workspaces: [
        {
          ...workspace,
          sessions: [
            { agentId: "agt_lead", sessionId: "session-a", access: "write" },
            { agentId: "agt_joined", sessionId: "session-b", access: "read" },
          ],
        },
      ],
      statuses: { "session-a": "idle", "session-b": "working" },
    });
    const session = host("ends");
    const core = commands(async () => ({ workspaceId: "wsp_a", worktree: "removed" }));
    await retireWorkspace({ host: session.fake, commands: core, lists, workspaceId: "wsp_a" });
    expect(session.posted).toEqual(["session.stop", "session.stop"]);
    expect(core.ran[0]).toBe("workspace.retire");
  });

  it("removes at once when no session runs, or the session host no longer has it", async () => {
    useWorkspaceStore.setState({ statuses: {} });
    const idle = host("hangs");
    await retireWorkspace({
      host: idle.fake,
      commands: commands(async () => ({})),
      lists,
      workspaceId: "wsp_a",
    });
    expect(idle.posted).toEqual([]);
    useWorkspaceStore.setState({ workspaces: [workspace], statuses: { "session-a": "working" } });
    const gone = host("not_found");
    await retireWorkspace({
      host: gone.fake,
      commands: commands(async () => ({})),
      lists,
      workspaceId: "wsp_a",
    });
    expect(gone.posted).toEqual(["session.stop"]);
    expect(gone.listeners.size).toBe(0);
  });

  it("passes on the core's refusal and keeps the workspace selected", async () => {
    useWorkspaceStore.setState({ statuses: {} });
    const refusal = new RequestFailure("application_failed", { coreCode: "workspace_has_changes" });
    const core = commands(async () => {
      throw refusal;
    });
    await expect(
      retireWorkspace({ host: host("hangs").fake, commands: core, lists, workspaceId: "wsp_a" }),
    ).rejects.toBe(refusal);
    expect(useWorkspaceStore.getState().selected).toBe("wsp_a");
  });

  it("asks the core to remove it with its changes only when the owner chose that", async () => {
    useWorkspaceStore.setState({ statuses: {} });
    const sent: Record<string, unknown>[] = [];
    const core: ApplicationCommands = {
      async run(command, arguments_) {
        if (command === "workspace.retire") sent.push(arguments_ as Record<string, unknown>);
        if (command === "workspace.list") return { workspaces: [], commands: [] } as never;
        return { repositories: [] } as never;
      },
    };
    const input = { host: host("hangs").fake, commands: core, lists, workspaceId: "wsp_a" };
    await retireWorkspace(input);
    useWorkspaceStore.setState({ workspaces: [workspace], selected: "wsp_a" });
    await retireWorkspace({ ...input, discardChanges: true });
    expect(sent).toEqual([
      { workspaceId: "wsp_a" },
      { workspaceId: "wsp_a", discardChanges: true },
    ]);
  });

  it("keeps the restore command of changes the core kept, until the next removal", async () => {
    useWorkspaceStore.setState({ statuses: {} });
    const restore = "git -C '/repo' worktree add --detach '/wt' refs/lervo/retired-changes/wsp_a";
    const answer = (keptChanges?: object) =>
      commands(async () => ({
        workspaceId: "wsp_a",
        worktree: "removed",
        branch: "kept",
        ...(keptChanges === undefined ? {} : { keptChanges }),
      }));
    const input = { host: host("hangs").fake, lists, workspaceId: "wsp_a", discardChanges: true };
    await retireWorkspace({
      ...input,
      commands: answer({ ref: "refs/lervo/retired-changes/wsp_a", restore }),
    });
    expect(useKeptChanges.getState().restore).toBe(restore);
    useWorkspaceStore.setState({ workspaces: [workspace], selected: "wsp_a" });
    await retireWorkspace({ ...input, commands: answer() });
    expect(useKeptChanges.getState().restore).toBeNull();
  });

  it("gives up with session_stop_timeout when the session never ends", async () => {
    vi.useFakeTimers();
    try {
      const session = host("hangs");
      const core = commands(async () => ({}));
      const retiring = retireWorkspace({
        host: session.fake,
        commands: core,
        lists,
        workspaceId: "wsp_a",
      });
      const outcome = expect(retiring).rejects.toMatchObject({ code: "session_stop_timeout" });
      await vi.advanceTimersByTimeAsync(15_000);
      await outcome;
      expect(core.ran).toEqual([]);
      expect(session.listeners.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
