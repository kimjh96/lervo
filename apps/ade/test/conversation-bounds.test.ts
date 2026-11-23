import type { ConversationItem } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import type { HostMessage } from "@lervo/session-host-contract";

import { ConversationController } from "../src/features/conversation/model/controller";
import { RecentWindows, windowBytes } from "../src/features/conversation/model/recent";
import { StandInConversation } from "../src/features/conversation/model/stand-in-conversation";
import { useConversationStore } from "../src/features/conversation/model/store";
import {
  type ConversationWindow,
  MAX_WINDOW_ITEMS,
} from "../src/features/conversation/model/window";
import type { SessionHost } from "../src/ports";

/** A session host port whose conversation starts empty and whose messages the test emits. */
function host() {
  const listeners = new Set<(message: HostMessage) => void>();
  const port: SessionHost = {
    connection: "connected",
    async request(message) {
      if (message.kind !== "conversation.range") throw new Error(message.kind);
      return {
        kind: "conversation.page",
        requestId: "req_1",
        sessionId: "ses_1",
        items: [],
        hasEarlier: false,
        hasLater: false,
      };
    },
    async post() {},
    async send() {},
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onState: () => () => undefined,
  };
  return {
    port,
    emit: (message: HostMessage) => listeners.forEach((listener) => listener(message)),
  };
}

const windowOf = (text: string): ConversationWindow => ({
  items: [
    { kind: "agent_message", itemId: "i1", createdAtMs: 1, state: "complete", text },
  ] as ConversationItem[],
  hasEarlier: false,
  hasLater: false,
});

describe("recently closed conversations", () => {
  it("keep their windows within a byte budget, forgetting the least recent first", () => {
    const bytes = windowBytes(windowOf("x".repeat(100)));
    const recent = new RecentWindows(bytes * 2);
    recent.remember("ses_1", windowOf("x".repeat(100)));
    recent.remember("ses_2", windowOf("y".repeat(100)));
    recent.remember("ses_1", windowOf("x".repeat(100)));
    recent.remember("ses_3", windowOf("z".repeat(100)));
    expect(recent.get("ses_2")).toBeUndefined();
    expect(recent.get("ses_1")).toBeDefined();
    expect(recent.get("ses_3")).toBeDefined();
    recent.remember("ses_4", windowOf("w".repeat(1000)));
    expect(recent.get("ses_4")).toBeUndefined();
  });
});

describe("the conversation of work being started", () => {
  it("shows the instruction as the first message and cannot send yet", async () => {
    const source = new StandInConversation("Fix the login page", () => 7);
    await source.open();
    const [first] = useConversationStore.getState().window.items;
    expect(first).toMatchObject({ kind: "user_message", text: "Fix the login page" });
    await expect(source.send()).rejects.toMatchObject({ code: "session_not_started" });
  });
});

describe("items that arrive live", () => {
  it("animate only while they are in the window, so the set stays bounded", async () => {
    const session = host();
    const controller = new ConversationController(
      session.port,
      { workspaceId: "wks_1", sessionId: "ses_1" },
      (run) => run(),
    );
    await controller.open();
    for (let index = 0; index < MAX_WINDOW_ITEMS + 50; index += 1)
      session.emit({
        kind: "conversation.appended",
        sessionId: "ses_1",
        sequence: index + 1,
        items: [
          {
            kind: "user_message",
            itemId: `i${index}`,
            createdAtMs: index,
            state: "complete",
            text: "hi",
          },
        ],
      });
    const { window, arrived } = useConversationStore.getState();
    const kept = new Set(window.items.map((item) => item.itemId));
    expect(arrived.size).toBeLessThanOrEqual(MAX_WINDOW_ITEMS);
    expect([...arrived].every((itemId) => kept.has(itemId))).toBe(true);
    controller.close();
  });
});
