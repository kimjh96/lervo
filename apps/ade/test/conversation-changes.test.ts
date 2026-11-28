import { beforeEach, describe, expect, it } from "vitest";

import {
  changesConversations,
  pinConversation,
  renameConversation,
} from "../src/features/workspaces/model/changes";
import { useWorkspaceStore } from "../src/features/workspaces/model/store";
import type { Workspace } from "../src/features/workspaces/model/types";
import { type ApplicationCommands, RequestFailure } from "../src/ports";
import { movedOf } from "../src/ui/moving";

function workspace(id: string, activeAt: string, pinnedAt?: string): Workspace {
  return {
    workspaceId: id,
    projectId: "prj_1",
    repositoryName: "web",
    branch: `lervo/${id}`,
    title: `Title ${id}`,
    provider: "claude",
    conversationMode: "native",
    sessionId: `session-${id}`,
    preparedAt: activeAt,
    activeAt,
    ...(pinnedAt === undefined ? {} : { pinnedAt }),
  };
}

const newest = workspace("newest", "2026-11-28T03:00:00.000Z");
const middle = workspace("middle", "2026-11-28T02:00:00.000Z");
const oldest = workspace("oldest", "2026-11-28T01:00:00.000Z");

/**
 * A core that answers the list from `listed` once a change finished, and holds each change until
 * the test lets it answer, so the test sees what shows while the core works.
 */
function core(listed: () => Workspace[], refuse = false) {
  const ran: string[] = [];
  let answer: () => void = () => undefined;
  const commands: ApplicationCommands = {
    async run(command, arguments_ = {}) {
      ran.push(`${command}:${JSON.stringify(arguments_)}`);
      if (command === "workspace.list")
        return { workspaces: listed(), commands: ["workspace.rename", "workspace.pin"] } as never;
      if (command === "repository.list") return { repositories: [] } as never;
      await new Promise<void>((resolve) => (answer = resolve));
      if (refuse) throw new RequestFailure("application_failed", { coreCode: "workspace_busy" });
      return {} as never;
    },
  };
  return { commands, ran, answer: () => answer() };
}

const order = () => useWorkspaceStore.getState().workspaces.map((item) => item.workspaceId);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useWorkspaceStore.setState({
    workspaces: [newest, middle, oldest],
    loaded: true,
    changeFailure: null,
    renaming: null,
    advertisedCommands: ["workspace.rename", "workspace.pin"],
  });
});

describe("renaming and pinning a conversation", () => {
  it("offers only the changes the core answers", () => {
    expect(changesConversations(["workspace.pin"])).toEqual({ renames: false, pins: true });
    expect(changesConversations(null)).toEqual({ renames: false, pins: false });
  });

  it("shows the owner's title at once and keeps it once the core answers", async () => {
    const renamed = { ...oldest, title: "Release checklist" };
    const { commands, ran, answer } = core(() => [newest, middle, renamed]);
    const renaming = renameConversation({ commands }, "oldest", "Release checklist");
    await flush();
    expect(useWorkspaceStore.getState().workspaces[2]?.title).toBe("Release checklist");
    answer();
    await renaming;
    expect(ran[0]).toBe('workspace.rename:{"workspaceId":"oldest","title":"Release checklist"}');
    expect(useWorkspaceStore.getState().workspaces[2]?.title).toBe("Release checklist");
  });

  it("moves a pinned conversation to the top at once, and back to its place when unpinned", async () => {
    const at = new Date("2026-11-28T09:00:00.000Z");
    const pinned = core(() => [
      workspace("middle", middle.activeAt!, at.toISOString()),
      newest,
      oldest,
    ]);
    const pinning = pinConversation({ commands: pinned.commands }, "middle", true, at);
    await flush();
    expect(order()).toEqual(["middle", "newest", "oldest"]);
    pinned.answer();
    await pinning;
    expect(order()).toEqual(["middle", "newest", "oldest"]);
    expect(useWorkspaceStore.getState().workspaces[0]?.pinnedAt).toBe(at.toISOString());

    // Unpinned, it returns to its place by activity before the core answers.
    const unpinned = core(() => [newest, middle, oldest]);
    const unpinning = pinConversation({ commands: unpinned.commands }, "middle", false);
    await flush();
    expect(order()).toEqual(["newest", "middle", "oldest"]);
    expect(useWorkspaceStore.getState().workspaces[1]?.pinnedAt).toBeUndefined();
    unpinned.answer();
    await unpinning;
    expect(unpinned.ran[0]).toBe('workspace.pin:{"workspaceId":"middle","pinned":false}');
  });

  it("shows the conversation as it was after a refusal, with the code", async () => {
    const { commands, answer } = core(() => [newest, middle, oldest], true);
    const pinning = pinConversation({ commands }, "oldest", true);
    await flush();
    expect(order()).toEqual(["oldest", "newest", "middle"]);
    answer();
    await pinning;
    expect(order()).toEqual(["newest", "middle", "oldest"]);
    expect(useWorkspaceStore.getState().changeFailure).toBe("application_failed");
  });
});

describe("rows that move", () => {
  const key = (item: { id: string; place: string }) => `${item.place}:${item.id}`;
  const id = (item: { id: string }) => item.id;

  it("names a row that changed its place, never one that arrived or stayed", () => {
    const before = [
      { id: "a", place: "listed" },
      { id: "b", place: "listed" },
    ];
    const after = [
      { id: "b", place: "pinned" },
      { id: "a", place: "listed" },
      { id: "c", place: "listed" },
    ];
    expect([...movedOf(before, after, key, id)]).toEqual(["pinned:b"]);
    expect(movedOf(after, after, key, id).size).toBe(0);
  });
});
