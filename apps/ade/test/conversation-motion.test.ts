import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import { ConversationController } from "../src/features/conversation/model/controller";
import { useConversationStore } from "../src/features/conversation/model/store";
import { activityOf } from "../src/features/conversation/model/activity";
import {
  type Arrival,
  nextShown,
  paceDeadline,
  recordArrival,
} from "../src/features/conversation/model/pacing";
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

  it("keeps a steady stream within the pace of each character's arrival", () => {
    // The fastest provider: 30 characters every 2 ms for 2 seconds, shown at 60 frames a second.
    const frame = 1000 / 60;
    let arrivals: Arrival[] = [];
    let text = "";
    let shown = 0;
    let worst = 0;
    const arrivedAt: number[] = [];
    let next = 0;
    for (let now = 0; now < 2400; now += frame) {
      for (; next <= now && next < 2000; next += 2) {
        text += "x".repeat(30);
        for (let index = 0; index < 30; index += 1) arrivedAt.push(next);
        arrivals = recordArrival(arrivals, shown, text.length, next);
      }
      const deadline = paceDeadline(arrivals, shown) ?? now;
      const before = shown;
      shown = nextShown(text, shown, frame, deadline - now + frame);
      for (let index = before; index < shown; index += 1)
        worst = Math.max(worst, now - (arrivedAt[index] ?? now));
    }
    expect(shown).toBe(text.length);
    // A deadline restarted at each growth let the first characters trail by 136 ms here.
    expect(worst).toBeLessThanOrEqual(121);
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
