import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { bindWorkspaces, reloadWorkspaces } from "../src/features/workspaces/model/controller";
import {
  arrivals,
  groupByRepository,
  notificationFor,
  visibleStatus,
} from "../src/features/workspaces/model/decisions";
import { useWorkspaceStore } from "../src/features/workspaces/model/store";
import type { Workspace } from "../src/features/workspaces/model/types";
import {
  type HostTransport,
  SessionHostClient,
  SessionHostCommands,
  type ShellMessage,
} from "../src/platform/session-host";
import { RequestFailure } from "../src/ports";

function workspace(id: string, repositoryName: string, preparedAt: string): Workspace {
  return {
    workspaceId: id,
    projectId: "prj_1",
    repositoryName,
    branch: `lervo/${id}`,
    title: `Title ${id}`,
    provider: "claude",
    conversationMode: "native",
    sessionId: `session-${id}`,
    preparedAt,
  };
}

/** A connected client whose host answers application commands from `answers`. */
async function connected(answers: Record<string, Record<string, unknown>>) {
  let emit: (message: ShellMessage) => void = () => undefined;
  const sent: ClientMessage[] = [];
  const transport: HostTransport = {
    async connect(onControl) {
      emit = onControl;
    },
    async send(message) {
      sent.push(message);
      if (message.kind === "session.open") {
        const { requestId, workspaceId, conversationMode = "native" } = message;
        queueMicrotask(() =>
          emit({
            kind: "session.opened",
            requestId,
            sessionId: `session-${workspaceId}`,
            workspaceId,
            conversationMode,
            channel: 1,
          }),
        );
        return;
      }
      if (message.kind !== "application.command") return;
      const result = answers[message.command];
      queueMicrotask(() =>
        emit(
          result === undefined
            ? {
                kind: "request.failed",
                requestId: message.requestId,
                code: "application_failed",
                parameters: {},
              }
            : { kind: "application.result", requestId: message.requestId, result },
        ),
      );
    },
    async input() {},
  };
  const client = new SessionHostClient(
    transport,
    () => 0 as unknown as ReturnType<typeof setTimeout>,
  );
  const commands = new SessionHostCommands(client);
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { client, commands, sent, emit: (message: HostMessage) => emit(message) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  useWorkspaceStore.setState({ repositories: [], workspaces: [], statuses: {}, selected: null });
});

describe("workspace decisions", () => {
  it("groups by repository and orders each group newest first", () => {
    const groups = groupByRepository([
      workspace("a", "web", "2026-11-23T01:00:00Z"),
      workspace("b", "api", "2026-11-23T02:00:00Z"),
      workspace("c", "web", "2026-11-23T03:00:00Z"),
    ]);
    expect(
      groups.map((group) => [
        group.repositoryName,
        group.workspaces.map((item) => item.workspaceId),
      ]),
    ).toEqual([
      ["api", ["b"]],
      ["web", ["c", "a"]],
    ]);
  });

  it("treats only workspaces new since an earlier list as arrivals", () => {
    const first = [workspace("a", "web", "2026-11-23T01:00:00Z")];
    const next = [...first, workspace("b", "web", "2026-11-23T02:00:00Z")];
    expect([...arrivals(null, next)]).toEqual([]);
    expect([...arrivals(first, next)]).toEqual(["b"]);
    expect([...arrivals(next, next)]).toEqual([]);
  });

  it("colors only working and needs-you, and notifies only for what the user does not watch", () => {
    expect(
      ["starting", "working", "needs_user", "idle", "ended"].map((status) =>
        visibleStatus(status as never),
      ),
    ).toEqual(["working", "working", "needsYou", null, null]);
    expect(notificationFor("working", "needs_user", false)).toBe("needsYou");
    expect(notificationFor("working", "idle", false)).toBe("finished");
    expect(notificationFor("working", "idle", true)).toBeNull();
    expect(notificationFor(undefined, "needs_user", false)).toBeNull();
    expect(notificationFor("idle", "ended", false)).toBeNull();
  });
});

describe("application commands", () => {
  it("answers by request ID and turns request.failed into a RequestFailure", async () => {
    const host = await connected({ "workspace.list": { workspaces: [] } });
    await expect(host.commands.run("workspace.list")).resolves.toEqual({ workspaces: [] });
    await expect(host.commands.run("workspace.start")).rejects.toEqual(
      new RequestFailure("application_failed"),
    );
  });
});

describe("the workspace binding", () => {
  it("loads the lists, watches every session, and notifies for an unwatched workspace", async () => {
    const listed = [workspace("a", "web", "2026-11-23T01:00:00Z")];
    const host = await connected({
      "workspace.list": { workspaces: listed },
      "repository.list": { repositories: [{ projectId: "prj_1", name: "web" }] },
    });
    const notified: string[] = [];
    bindWorkspaces({
      client: host.client,
      commands: host.commands,
      notifier: { notify: (title, body) => notified.push(`${title}: ${body}`) },
      text: (kind, title) => ({ title, body: kind }),
      isFocused: () => true,
    });
    await flush();
    expect(host.sent.some((message) => message.kind === "sessions.watch")).toBe(true);
    expect(useWorkspaceStore.getState().workspaces).toEqual(listed);
    expect(useWorkspaceStore.getState().repositories).toEqual([
      { projectId: "prj_1", name: "web" },
    ]);

    const status = (value: "working" | "idle", sequence: number) =>
      host.emit({ kind: "session.status", sessionId: "session-a", sequence, status: value });
    status("working", 1);
    status("idle", 2);
    expect(notified).toEqual(["Title a: finished"]);
    useWorkspaceStore.getState().select("a");
    status("working", 3);
    status("idle", 4);
    expect(notified).toHaveLength(1);
    expect(useWorkspaceStore.getState().statuses).toEqual({ "session-a": "idle" });
  });
});

describe("reloading the lists", () => {
  it("keeps the last lists and records the failure when the core cannot answer", async () => {
    const host = await connected({});
    const kept = [workspace("a", "web", "2026-11-23T01:00:00Z")];
    useWorkspaceStore.setState({ workspaces: kept, listFailure: null });
    await expect(reloadWorkspaces(host.commands)).rejects.toEqual(
      new RequestFailure("application_failed"),
    );
    expect(useWorkspaceStore.getState().workspaces).toEqual(kept);
    expect(useWorkspaceStore.getState().listFailure).toBe("application_failed");
  });
});

describe("selecting a workspace", () => {
  it("changes nothing when the workspace is already selected", () => {
    useWorkspaceStore.setState({ selected: "wks_1" });
    let notified = 0;
    const unsubscribe = useWorkspaceStore.subscribe(() => (notified += 1));
    useWorkspaceStore.getState().select("wks_1");
    expect(notified).toBe(0);
    useWorkspaceStore.getState().select("wks_2");
    expect(notified).toBe(1);
    unsubscribe();
  });
});
