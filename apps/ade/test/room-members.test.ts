import { afterEach, describe, expect, it } from "vitest";

import { RoomMembers } from "../src/features/conversation/model/room-members";
import { useRoomStore } from "../src/features/conversation/model/room-store";
import { useWorkspaceStore } from "../src/features/workspaces";
import { type ApplicationCommands, RequestFailure, type SessionHost } from "../src/ports";

const member = { agentId: "agt_arin", sessionId: "ses_arin" };
const page = {
  kind: "conversation.page",
  requestId: "req_1",
  sessionId: "ses_arin",
  items: [],
  hasEarlier: false,
  hasLater: false,
};

/** A session host whose session runs once `runs()` says so. */
function host(runs: () => boolean): SessionHost & { attached: number } {
  const fake = {
    attached: 0,
    connection: "connected",
    async post() {
      if (!runs()) throw new RequestFailure("session_not_found");
      fake.attached += 1;
    },
    async request() {
      return page;
    },
    async send() {},
    onMessage: () => () => undefined,
    onState: () => () => undefined,
  };
  return fake as unknown as SessionHost & { attached: number };
}

function commands(join: () => Promise<void>): ApplicationCommands & { joins: number } {
  const fake = {
    joins: 0,
    async run() {
      fake.joins += 1;
      await join();
      return {};
    },
  };
  return fake as unknown as ApplicationCommands & { joins: number };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  useWorkspaceStore.setState({ statuses: {} });
  useRoomStore.setState({ members: {} });
});

describe("a joined agent's session in the open conversation", () => {
  it("attaches at once to a running session, without asking the core", async () => {
    const client = host(() => true);
    const core = commands(async () => {});
    new RoomMembers(client, core, "wsp_1", "agt_elio").follow(member);
    await settle();
    expect(client.attached).toBe(1);
    expect(core.joins).toBe(0);
    expect(useRoomStore.getState().members.ses_arin?.window.items).toEqual([]);
  });

  it("asks the core to reopen a stopped session and attaches once the host reports it", async () => {
    let started = false;
    const client = host(() => started);
    const core = commands(async () => {
      started = true;
      useWorkspaceStore.setState({ statuses: { ses_arin: "idle" } });
    });
    new RoomMembers(client, core, "wsp_1", "agt_elio", () => () => undefined).follow(member);
    await settle();
    await settle();
    expect(core.joins).toBe(1);
    expect(client.attached).toBe(1);
  });

  it("shows a room line when the session cannot reopen, never failing silently", async () => {
    const client = host(() => false);
    const core = commands(async () => {
      throw new RequestFailure("mention_target_inactive");
    });
    new RoomMembers(client, core, "wsp_1", "agt_elio").follow(member);
    await settle();
    await settle();
    expect(useRoomStore.getState().members.ses_arin?.window.items).toMatchObject([
      {
        kind: "lervo_notice",
        code: "room_rejoin_failed",
        parameters: { code: "mention_target_inactive" },
      },
    ]);
  });
});
