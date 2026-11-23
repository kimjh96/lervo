import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import { ConversationController } from "../src/features/conversation";
import { TerminalController } from "../src/features/terminal/model/controller";
import {
  type HostTransport,
  RequestFailure,
  SessionHostClient,
  type ShellMessage,
} from "../src/platform/session-host";

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
    async input() {},
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

  it("reopens the terminal after a resync and reports failures to its view", async () => {
    let failing = false;
    const session = await host((message) => {
      if (message.kind !== "session.open") return undefined;
      return failing
        ? {
            kind: "request.failed",
            requestId: message.requestId,
            code: "provider_cli_unavailable",
            parameters: {},
          }
        : {
            kind: "session.opened",
            requestId: message.requestId,
            sessionId: "ses_1",
            workspaceId: "wks_1",
            conversationMode: "cli",
            channel: 1,
          };
    });
    const failures: string[] = [];
    const controller = new TerminalController(session.client, "wks_1", {
      write: () => undefined,
      failed: (code) => failures.push(code),
    });
    await controller.open();
    failing = true;
    session.emit({ kind: "session.resync_required", sessionId: "ses_1" });
    await flush();
    await flush();
    expect(session.sent.filter((message) => message.kind === "session.open")).toHaveLength(2);
    expect(failures).toEqual(["provider_cli_unavailable"]);
    controller.close();
  });
});
