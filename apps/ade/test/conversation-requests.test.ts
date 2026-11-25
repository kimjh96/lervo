import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import { ConversationController } from "../src/features/conversation/model/controller";
import {
  type HostTransport,
  SessionHostClient,
  type ShellMessage,
} from "../src/platform/session-host";
import { RequestFailure } from "../src/ports";

type Answer = (message: ClientMessage & { requestId: string }) => HostMessage | undefined;

/** A session host whose answers come from `answer`, recording every message it receives. */
async function host(answer: Answer) {
  let emit: (message: ShellMessage) => void = () => undefined;
  const sent: ClientMessage[] = [];
  const transport: HostTransport = {
    async connect(onControl) {
      emit = onControl;
    },
    async send(message) {
      sent.push(message);
      const reply = "requestId" in message ? answer(message) : undefined;
      if (reply !== undefined) queueMicrotask(() => emit(reply));
    },
  };
  const client = new SessionHostClient(
    transport,
    () => 0 as unknown as ReturnType<typeof setTimeout>,
    {
      cancel: () => undefined,
    },
  );
  client.start();
  await flush();
  return { client, sent, emit: (message: HostMessage) => emit(message) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const page = (requestId: string): HostMessage => ({
  kind: "conversation.page",
  requestId,
  sessionId: "ses_1",
  items: [],
  hasEarlier: false,
  hasLater: false,
});

describe("replies and resynchronization", () => {
  it("resolves a reply once the provider received it and rejects with a refusal", async () => {
    let refuse = false;
    const session = await host((message) => {
      if (message.kind === "conversation.range") return page(message.requestId);
      if (message.kind !== "session.send") return undefined;
      return refuse
        ? {
            kind: "request.failed",
            requestId: message.requestId,
            code: "session_ended",
            parameters: {},
          }
        : { kind: "session.sent", requestId: message.requestId, sessionId: "ses_1" };
    });
    const controller = new ConversationController(
      session.client,
      { workspaceId: "wks_1", sessionId: "ses_1" },
      (run) => run(),
    );
    await controller.open();
    await expect(controller.send("hi")).resolves.toBeUndefined();
    refuse = true;
    await expect(controller.send("again")).rejects.toEqual(new RequestFailure("session_ended"));
    controller.close();
  });

  it("stops the running turn and rejects with the session host's refusal", async () => {
    let refuse = false;
    const session = await host((message) => {
      if (message.kind === "conversation.range") return page(message.requestId);
      if (message.kind !== "session.interrupt") return undefined;
      return refuse
        ? {
            kind: "request.failed",
            requestId: message.requestId,
            code: "interrupt_unsupported",
            parameters: {},
          }
        : { kind: "session.interrupted", requestId: message.requestId, sessionId: "ses_1" };
    });
    const controller = new ConversationController(
      session.client,
      { workspaceId: "wks_1", sessionId: "ses_1" },
      (run) => run(),
    );
    await controller.open();
    await expect(controller.interrupt()).resolves.toBeUndefined();
    expect(session.sent).toContainEqual(
      expect.objectContaining({ kind: "session.interrupt", sessionId: "ses_1" }),
    );
    refuse = true;
    await expect(controller.interrupt()).rejects.toEqual(
      new RequestFailure("interrupt_unsupported"),
    );
    controller.close();
  });

  it("reopens a session that last ran in the terminal in the native conversation first", async () => {
    const session = await host((message) => {
      if (message.kind === "conversation.range") return page(message.requestId);
      if (message.kind !== "session.open") return undefined;
      return {
        kind: "session.opened",
        requestId: message.requestId,
        sessionId: "ses_1",
        workspaceId: "wks_1",
        conversationMode: "native",
        channel: 2,
      };
    });
    const controller = new ConversationController(
      session.client,
      { workspaceId: "wks_1", sessionId: "ses_old", reopenNatively: true },
      (run) => run(),
    );
    await controller.open();
    expect(session.sent.map((message) => message.kind).slice(0, 2)).toEqual([
      "session.open",
      "session.attach",
    ]);
    expect(session.sent[0]).toMatchObject({ workspaceId: "wks_1", conversationMode: "native" });
    expect(session.sent[1]).toMatchObject({ sessionId: "ses_1" });
    controller.close();
  });

  it("attaches and loads again when the session host says the conversation fell behind", async () => {
    const session = await host((message) =>
      message.kind === "conversation.range" ? page(message.requestId) : undefined,
    );
    const controller = new ConversationController(
      session.client,
      { workspaceId: "wks_1", sessionId: "ses_1" },
      (run) => run(),
    );
    await controller.open();
    const attaches = () =>
      session.sent.filter((message) => message.kind === "session.attach").length;
    expect(attaches()).toBe(1);
    session.emit({ kind: "session.resync_required", sessionId: "ses_1" });
    await flush();
    expect(attaches()).toBe(2);
    controller.close();
  });
});
