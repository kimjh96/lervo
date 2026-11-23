import type { ClientMessage, HostMessage } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import {
  type HostTransport,
  RequestFailure,
  SessionHostClient,
  type ShellMessage,
} from "../src/platform/session-host";

/** A client over a transport that records sends and lets the test answer them. */
async function connected(options: { refuse?: string } = {}) {
  let emit: (message: ShellMessage) => void = () => undefined;
  const sent: ClientMessage[] = [];
  const timers: (() => void)[] = [];
  const transport: HostTransport = {
    async connect(onControl) {
      emit = onControl;
    },
    async send(message) {
      if (options.refuse !== undefined) throw new Error(options.refuse);
      sent.push(message);
    },
    async input() {},
  };
  const client = new SessionHostClient(
    transport,
    (run) => {
      timers.push(run);
      return 0 as unknown as ReturnType<typeof setTimeout>;
    },
    { cancel: () => undefined, requestPrefix: "t" },
  );
  client.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { client, sent, emit, expire: () => timers.forEach((run) => run()) };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("requests through the session-host client", () => {
  it("assigns IDs and resolves with the first message that answers each", async () => {
    const host = await connected();
    const answer = host.client.request({ kind: "session.send", sessionId: "ses_1", text: "hi" });
    await flush();
    const [request] = host.sent as (ClientMessage & { requestId: string })[];
    expect(request?.requestId).toBe("req_t_1");
    const sent: HostMessage = { kind: "session.sent", requestId: "req_t_1", sessionId: "ses_1" };
    host.emit(sent);
    await expect(answer).resolves.toEqual(sent);
  });

  it("rejects with the session host's refusal, a timeout, or the end of the connection", async () => {
    const host = await connected();
    const refused = host.client.request({ kind: "session.open", workspaceId: "wks_1" });
    const timed = host.client.request({ kind: "session.open", workspaceId: "wks_2" });
    await flush();
    host.emit({
      kind: "request.failed",
      requestId: "req_t_1",
      code: "workspace_not_found",
      parameters: {},
    });
    await expect(refused).rejects.toEqual(new RequestFailure("workspace_not_found"));
    host.expire();
    await expect(timed).rejects.toEqual(new RequestFailure("request_timeout"));
    const dropped = host.client.request({ kind: "session.open", workspaceId: "wks_3" });
    await flush();
    host.emit({ kind: "host.disconnected" });
    await expect(dropped).rejects.toEqual(new RequestFailure("session_host_unavailable"));
  });

  it("keeps the shell's code when it refuses a send", async () => {
    const host = await connected({ refuse: "message_invalid" });
    await expect(
      host.client.request({ kind: "session.open", workspaceId: "wks_1" }),
    ).rejects.toEqual(new RequestFailure("message_invalid"));
  });
});

describe("timers in the request broker", () => {
  it("calls the scheduler and the canceler without a receiver, as WebKit's timers require", async () => {
    let emit: (message: ShellMessage) => void = () => undefined;
    const sent: ClientMessage[] = [];
    // Like WebKit's `setTimeout`, these refuse to run as a method of another object.
    function schedule(this: unknown, run: () => void) {
      if (this !== undefined)
        throw new TypeError("Can only call setTimeout on instances of Window");
      void run;
      return 1 as unknown as ReturnType<typeof setTimeout>;
    }
    function cancel(this: unknown) {
      if (this !== undefined)
        throw new TypeError("Can only call clearTimeout on instances of Window");
    }
    const client = new SessionHostClient(
      {
        async connect(onControl) {
          emit = onControl;
        },
        async send(message) {
          sent.push(message);
        },
        async input() {},
      },
      schedule,
      { cancel, requestPrefix: "t" },
    );
    client.start();
    await flush();
    const answer = client.request({ kind: "session.open", workspaceId: "wks_1" });
    await flush();
    emit({
      kind: "session.opened",
      requestId: "req_t_1",
      sessionId: "ses_1",
      workspaceId: "wks_1",
      conversationMode: "native",
      channel: 1,
    });
    await expect(answer).resolves.toMatchObject({ kind: "session.opened" });
    expect(sent).toHaveLength(1);
  });
});
