import type { ClientMessage, ConversationItem, HostMessage } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import { ConversationController } from "../src/features/conversation/model/controller";
import { useConversationStore } from "../src/features/conversation/model/store";
import {
  type HostTransport,
  SessionHostClient,
  type ShellMessage,
} from "../src/platform/session-host";

const item = (
  position: number,
  text: string,
  state: "streaming" | "complete" = "complete",
): ConversationItem => ({
  kind: "agent_message",
  itemId: `i${position}`,
  createdAtMs: position,
  state,
  text,
});

/**
 * A session host that runs only `ses_new`, which `session.open` starts. With `stored`, the index
 * `ses_old` left answers its ranges, as a current session host's does.
 */
async function scriptedHost(options: { stored?: boolean } = {}) {
  let emit: (message: ShellMessage) => void = () => undefined;
  const sent: ClientMessage[] = [];
  const answer = (message: HostMessage) => queueMicrotask(() => emit(message));
  const transport: HostTransport = {
    async connect(onControl) {
      emit = onControl;
    },
    async send(message) {
      sent.push(message);
      if (message.kind === "session.attach" && message.sessionId !== "ses_new")
        answer({
          kind: "request.failed",
          requestId: message.requestId,
          code: "session_not_found",
          parameters: {},
        });
      if (message.kind === "conversation.range" && message.sessionId !== "ses_new")
        answer(
          options.stored === true
            ? {
                kind: "conversation.page",
                requestId: message.requestId,
                sessionId: message.sessionId,
                items: [item(1, "Stored")],
                hasEarlier: false,
                hasLater: false,
                stored: true,
              }
            : {
                kind: "request.failed",
                requestId: message.requestId,
                code: "session_not_found",
                parameters: {},
              },
        );
      if (message.kind === "conversation.range" && message.sessionId === "ses_new")
        answer({
          kind: "conversation.page",
          requestId: message.requestId,
          sessionId: "ses_new",
          items: [item(1, "Earlier"), item(2, "Hel", "streaming")],
          hasEarlier: false,
          hasLater: false,
        });
      if (message.kind === "session.open")
        answer({
          kind: "session.opened",
          requestId: message.requestId,
          sessionId: "ses_new",
          workspaceId: message.workspaceId,
          conversationMode: "native",
          channel: 1,
        });
    },
  };
  const client = new SessionHostClient(
    transport,
    () => 0 as unknown as ReturnType<typeof setTimeout>,
  );
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { client, sent, emit: (message: HostMessage) => emit(message) };
}

describe("the conversation controller", () => {
  it("shows the page a stopped session's index holds while it opens the session", async () => {
    for (const running of [undefined, false]) {
      const host = await scriptedHost({ stored: true });
      const shown: string[][] = [];
      const stop = useConversationStore.subscribe((state) =>
        shown.push(state.window.items.map((entry) => ("text" in entry ? entry.text : ""))),
      );
      const controller = new ConversationController(
        host.client,
        {
          workspaceId: "wsp_1",
          sessionId: "ses_old",
          ...(running === undefined ? {} : { running }),
        },
        () => undefined,
      );
      await controller.open();
      await new Promise((resolve) => setTimeout(resolve, 0));
      stop();
      // The stored page showed first, and the live page replaced it once the session opened.
      expect(shown).toContainEqual(["Stored"]);
      expect(shown.at(-1)).toEqual(["Earlier", "Hel"]);
      expect(useConversationStore.getState()).toMatchObject({ sessionId: "ses_new", error: null });
      expect(host.sent.filter((message) => message.kind === "session.open")).toHaveLength(1);
      controller.close();
    }
  });

  it("opens a session the host reported not running at once, asking its index for a page meanwhile", async () => {
    const host = await scriptedHost();
    const controller = new ConversationController(
      host.client,
      { workspaceId: "wsp_1", sessionId: "ses_old", running: false },
      () => undefined,
    );
    await controller.open();
    // No refused attach: the index's page and the open go out together, then the live page.
    expect(host.sent.map((message) => message.kind)).toEqual([
      "conversation.range",
      "session.open",
      "session.attach",
      "conversation.range",
    ]);
    expect(useConversationStore.getState()).toMatchObject({ sessionId: "ses_new", error: null });
    controller.close();
  });

  it("opens a session that no longer runs, loads its newest page, and applies live changes", async () => {
    const host = await scriptedHost();
    const frames: (() => void)[] = [];
    const controller = new ConversationController(
      host.client,
      { workspaceId: "wsp_1", sessionId: "ses_old" },
      (run) => frames.push(run),
    );
    await controller.open();
    expect(host.sent.map((message) => message.kind)).toEqual([
      "session.attach",
      "conversation.range",
      "session.open",
      "session.attach",
      "conversation.range",
    ]);
    expect(useConversationStore.getState().sessionId).toBe("ses_new");

    host.emit({
      kind: "conversation.delta",
      sessionId: "ses_new",
      sequence: 3,
      itemId: "i2",
      append: "lo",
    });
    host.emit({
      kind: "conversation.delta",
      sessionId: "ses_old",
      sequence: 4,
      itemId: "i2",
      append: "x",
    });
    expect(frames).toHaveLength(1);
    frames[0]?.();
    expect(useConversationStore.getState().window.items[1]).toMatchObject({ text: "Hello" });

    host.emit({
      kind: "conversation.appended",
      sessionId: "ses_new",
      sequence: 5,
      items: [item(2, "Hello"), item(3, "Done.")],
    });
    const state = useConversationStore.getState();
    expect(state.window.items.map((entry) => entry.itemId)).toEqual(["i1", "i2", "i3"]);
    expect([...state.arrived]).toEqual(["i3"]);

    controller.close();
    // Sends reach the shell in order, one after another.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(host.sent.at(-1)).toEqual({ kind: "session.detach", sessionId: "ses_new" });
  });
});
