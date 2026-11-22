import type { ClientMessage } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import {
  type ConnectionState,
  type HostTransport,
  parseTerminalFrame,
  SessionHostClient,
  type ShellMessage,
} from "../src/platform/session-host";

function fakeTransport(failures: number) {
  let attempts = 0;
  let control: ((message: ShellMessage) => void) | undefined;
  const sent: ClientMessage[] = [];
  const transport: HostTransport = {
    async connect(onControl) {
      attempts += 1;
      if (attempts <= failures) throw new Error("session_host_unavailable");
      control = onControl;
    },
    async send(message) {
      sent.push(message);
    },
    async input() {},
  };
  return { transport, sent, emit: (message: ShellMessage) => control?.(message) };
}

function manualScheduler() {
  const delays: number[] = [];
  let pending: (() => void) | undefined;
  const schedule = (run: () => void, ms: number) => {
    delays.push(ms);
    pending = run;
    return 0 as unknown as ReturnType<typeof setTimeout>;
  };
  return { schedule, delays, fire: () => pending?.() };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the session-host client", () => {
  it("retries with growing delays and resets them once connected", async () => {
    const fake = fakeTransport(3);
    const scheduler = manualScheduler();
    const client = new SessionHostClient(fake.transport, scheduler.schedule);
    const states: ConnectionState[] = [];
    client.onState((state) => states.push(state));
    client.start();
    for (let index = 0; index < 3; index += 1) {
      await flush();
      scheduler.fire();
    }
    await flush();
    expect(scheduler.delays).toEqual([500, 1000, 2000]);
    expect(client.connection).toBe("connected");
    fake.emit({ kind: "host.disconnected" });
    expect(states).toEqual(["unavailable", "connected", "reconnecting"]);
    expect(scheduler.delays.at(-1)).toBe(500);
  });

  it("delivers host messages and refuses to send while disconnected", async () => {
    const fake = fakeTransport(0);
    const client = new SessionHostClient(fake.transport, manualScheduler().schedule);
    const message = { kind: "session.detach", sessionId: "ses_1" } as const satisfies ClientMessage;
    await expect(client.send(message)).rejects.toThrow("session_host_unavailable");
    const received: string[] = [];
    client.onMessage((host) => received.push(host.kind));
    client.start();
    await flush();
    await client.send(message);
    fake.emit({ kind: "session.resync_required", sessionId: "ses_1" });
    expect(fake.sent).toEqual([message]);
    expect(received).toEqual(["session.resync_required"]);
  });

  it("splits terminal frames into channel, sequence, and bytes", () => {
    const frame = new ArrayBuffer(15);
    const view = new DataView(frame);
    view.setUint32(0, 7);
    view.setBigUint64(4, 42n);
    new Uint8Array(frame, 12).set([104, 105, 33]);
    const parsed = parseTerminalFrame(frame);
    expect(parsed?.channel).toBe(7);
    expect(parsed?.sequence).toBe(42n);
    expect(new TextDecoder().decode(parsed?.bytes)).toBe("hi!");
    expect(parseTerminalFrame(new ArrayBuffer(4))).toBeNull();
  });
});
