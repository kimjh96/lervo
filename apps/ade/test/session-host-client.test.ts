import type { ClientMessage } from "@lervo/session-host-contract";
import { describe, expect, it } from "vitest";

import {
  type HostTransport,
  SessionHostClient,
  type ShellMessage,
} from "../src/platform/session-host";
import type { ConnectionState } from "../src/ports";

function fakeTransport(failures: number) {
  let attempts = 0;
  let control: ((message: ShellMessage) => void) | undefined;
  const controls: ((message: ShellMessage) => void)[] = [];
  const sent: ClientMessage[] = [];
  let replaced = 0;
  const transport: HostTransport = {
    async connect(onControl) {
      attempts += 1;
      if (attempts <= failures) throw new Error("session_host_unavailable");
      control = onControl;
      controls.push(onControl);
    },
    async send(message) {
      sent.push(message);
    },
    replace: async () => {
      replaced += 1;
    },
  };
  return {
    transport,
    sent,
    controls,
    attempts: () => attempts,
    replaced: () => replaced,
    emit: (message: ShellMessage) => control?.(message),
  };
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

  it("keeps the reached session host's identity apart from host messages", async () => {
    const fake = fakeTransport(0);
    const client = new SessionHostClient(fake.transport, manualScheduler().schedule);
    const received: string[] = [];
    const identities: unknown[] = [];
    client.onMessage((host) => received.push(host.kind));
    client.onIdentity((identity) => identities.push(identity));
    client.start();
    await flush();
    expect(client.identity).toBeNull();
    const identity = { hostVersion: "0.3.0", appVersion: "0.3.1", replaceable: true };
    fake.emit({ kind: "host.identified", ...identity });
    expect(client.identity).toEqual(identity);
    expect(identities).toEqual([identity]);
    expect(received).toEqual([]);
    await client.replace();
    expect(fake.replaced()).toBe(1);
  });

  it("reconnects at once after a restart it asked for, and with backoff otherwise", async () => {
    const fake = fakeTransport(0);
    const scheduler = manualScheduler();
    const client = new SessionHostClient(fake.transport, scheduler.schedule);
    client.start();
    await flush();
    await client.replace();
    fake.emit({ kind: "host.disconnected" });
    expect(scheduler.delays).toEqual([0]);
    scheduler.fire();
    await flush();
    fake.emit({ kind: "host.disconnected" });
    expect(scheduler.delays).toEqual([0, 500]);
  });

  it("connects once however often it starts, and ignores a replaced connection's end", async () => {
    const fake = fakeTransport(0);
    const scheduler = manualScheduler();
    const client = new SessionHostClient(fake.transport, scheduler.schedule);
    client.start();
    client.start();
    await flush();
    expect(fake.attempts()).toBe(1);
    // The current connection ends, and the client connects again.
    fake.emit({ kind: "host.disconnected" });
    scheduler.fire();
    await flush();
    expect(fake.attempts()).toBe(2);
    expect(client.connection).toBe("connected");
    // The shell ended the first connection when the second started; its late end changes nothing.
    fake.controls[0]?.({ kind: "host.disconnected" });
    expect(client.connection).toBe("connected");
    expect(scheduler.delays).toEqual([500]);
  });

  it("hands sends to the shell one at a time, in order", async () => {
    const started: string[] = [];
    const finish: (() => void)[] = [];
    const transport: HostTransport = {
      async connect() {},
      replace: async () => undefined,
      send: (message) =>
        new Promise<void>((resolve) => {
          started.push(message.kind);
          finish.push(resolve);
        }),
    };
    const client = new SessionHostClient(transport, manualScheduler().schedule);
    client.start();
    await flush();
    void client.send({ kind: "sessions.watch" });
    void client.send({ kind: "session.attach", sessionId: "ses_1", afterSequence: 0 } as never);
    void client.send({ kind: "session.detach", sessionId: "ses_1" });
    await flush();
    expect(started).toEqual(["sessions.watch"]);
    finish.shift()?.();
    await flush();
    finish.shift()?.();
    await flush();
    expect(started).toEqual(["sessions.watch", "session.attach", "session.detach"]);
  });
});
