import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import { ConversationController } from "../src/features/conversation/model/controller";
import { useConversationStore } from "../src/features/conversation/model/store";
import { activityOf } from "../src/features/conversation/model/activity";
import { nextShown } from "../src/features/conversation/model/pacing";
import {
  type HostTransport,
  SessionHostClient,
  type ShellMessage,
} from "../src/platform/session-host";

describe("streamed text pacing", () => {
  it("reveals a burst evenly and shows all of it within the pace", () => {
    const text = "x".repeat(400);
    const frame = 1000 / 60;
    const frames: number[] = [];
    let shown = 0;
    let left = 120;
    while (shown < text.length && frames.length < 100) {
      shown = nextShown(text, shown, frame, left);
      left -= frame;
      frames.push(shown);
    }
    expect(frames[0]).toBe(56);
    expect(frames.length).toBeLessThanOrEqual(8);
    expect(nextShown(text, 400, frame, 120)).toBe(400);
  });

  it("moves at least one character a frame and never splits a surrogate pair", () => {
    expect(nextShown("abcdef", 0, 1, 120)).toBe(1);
    expect(nextShown("a\u{1F600}b", 1, 16, 16)).toBe(4);
    expect(nextShown("\u{1F600}b", 0, 1, 120)).toBe(2);
  });
});

describe("the agent's activity", () => {
  const window = (items: unknown[]) =>
    ({ items, hasEarlier: false, hasLater: false }) as Parameters<typeof activityOf>[0];
  it("names a streaming reply, a running tool, or thinking", () => {
    expect(
      activityOf(
        window([
          { kind: "agent_message", itemId: "i1", createdAtMs: 0, state: "streaming", text: "" },
        ]),
      ),
    ).toEqual({ kind: "writing" });
    expect(
      activityOf(
        window([
          {
            kind: "tool_activity",
            itemId: "i2",
            createdAtMs: 0,
            state: "complete",
            tool: { name: "Read", status: "running", calls: 1 },
          },
        ]),
      ),
    ).toEqual({ kind: "tool", name: "Read" });
    expect(activityOf(window([]))).toEqual({ kind: "thinking" });
  });
});

describe("the first message of new work", () => {
  it("stays until the session's copy replaces it, which does not arrive again", async () => {
    let emit: (message: ShellMessage) => void = () => undefined;
    const sent: ClientMessage[] = [];
    const transport: HostTransport = {
      async connect(onControl) {
        emit = onControl;
      },
      async send(message) {
        sent.push(message);
        if (message.kind === "conversation.range")
          queueMicrotask(() =>
            emit({
              kind: "conversation.page",
              requestId: message.requestId,
              sessionId: "ses_1",
              items: [],
              hasEarlier: false,
              hasLater: false,
            }),
          );
      },
      async input() {},
    };
    const client = new SessionHostClient(
      transport,
      () => 0 as unknown as ReturnType<typeof setTimeout>,
    );
    client.start();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const controller = new ConversationController(
      client,
      { workspaceId: "wks_1", sessionId: "ses_1", firstMessage: "Fix the build" },
      (run) => run(),
    );
    await controller.open();
    const texts = () =>
      useConversationStore
        .getState()
        .window.items.map((entry) => ("text" in entry ? entry.text : entry.kind));
    // The session has not reported anything yet, so the stand-in stays.
    expect(texts()).toEqual(["Fix the build"]);
    const reported: HostMessage = {
      kind: "conversation.appended",
      sessionId: "ses_1",
      sequence: 2,
      items: [
        {
          kind: "user_message",
          itemId: "i0",
          createdAtMs: 1,
          state: "complete",
          text: "Fix the build",
        },
      ],
    };
    emit(reported);
    expect(texts()).toEqual(["Fix the build"]);
    expect(useConversationStore.getState().window.items[0]?.itemId).toBe("i0");
    expect(useConversationStore.getState().arrived.has("i0")).toBe(false);
    controller.close();
  });
});
