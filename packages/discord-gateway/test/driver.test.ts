import { describe, expect, it, vi } from "vitest";

import {
  AuthenticatedDiscordGatewayDriver,
  includesDiscordGatewayIntents,
  requiredDiscordConversationIntents,
  type DiscordGatewayConnectionObserver,
  type DiscordGatewaySchedule,
  type DiscordGatewayTransport,
} from "../src/index.js";

class FixtureSchedule implements DiscordGatewaySchedule {
  private sequence = 0;
  readonly tasks = new Map<number, () => void>();
  readonly delays: number[] = [];

  schedule(delayMs: number, callback: () => void): unknown {
    const id = ++this.sequence;
    this.delays.push(delayMs);
    this.tasks.set(id, callback);
    return id;
  }

  cancel(handle: unknown): void {
    this.tasks.delete(handle as number);
  }

  runNext(): void {
    const entry = this.tasks.entries().next().value as [number, () => void] | undefined;
    if (entry === undefined) throw new Error("No scheduled Discord Gateway task.");
    this.tasks.delete(entry[0]);
    entry[1]();
  }
}

class FixtureTransport implements DiscordGatewayTransport {
  readonly connections: Array<{
    url: string;
    observer: DiscordGatewayConnectionObserver;
    sent: string[];
    close: ReturnType<typeof vi.fn>;
  }> = [];

  connect(url: string, observer: DiscordGatewayConnectionObserver) {
    const connection = { url, observer, sent: [] as string[], close: vi.fn() };
    this.connections.push(connection);
    return {
      send: (payload: string) => connection.sent.push(payload),
      close: connection.close,
    };
  }
}

function emit(observer: DiscordGatewayConnectionObserver, payload: unknown): void {
  observer.message(JSON.stringify(payload));
}

async function settled(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

function fixture(
  onReady: () => void | Promise<void> = () => undefined,
  onError?: (error: Error) => void,
) {
  const transport = new FixtureTransport();
  const schedule = new FixtureSchedule();
  const dispatches: Array<{ sessionHandle: string; body: Uint8Array }> = [];
  const verified = vi.fn();
  const ready = vi.fn(onReady);
  const driver = new AuthenticatedDiscordGatewayDriver({
    applicationId: "999999999999999999",
    botToken: `discord.${"t".repeat(40)}`,
    intents: 37_377,
    transport,
    schedule,
    reconnectDelayMs: 100,
    heartbeatJitter: () => 0.25,
    createSessionHandle: () => `discord_session_${transport.connections.length + 1}`,
    onReady: ready,
    ...(onError === undefined ? {} : { onError }),
    async onDispatch(dispatch) {
      dispatches.push(dispatch);
      verified(
        await driver.verifyDispatch({
          sessionHandle: dispatch.sessionHandle,
          applicationId: "999999999999999999",
          sequence: JSON.parse(Buffer.from(dispatch.body).toString("utf8")).s as number,
          eventName: "MESSAGE_CREATE",
          verifiedAt: "2026-09-07T09:00:00.000Z",
        }),
      );
    },
  });
  return { driver, transport, schedule, dispatches, verified, ready };
}

describe("authenticated Discord Gateway driver", () => {
  it("dispatches interactions while READY history reconciliation is still running", async () => {
    let finishReady!: () => void;
    const readyWait = new Promise<void>((resolve) => {
      finishReady = resolve;
    });
    const setup = fixture(() => readyWait);
    setup.driver.start();
    const connection = setup.transport.connections[0]!;
    emit(connection.observer, { op: 10, d: { heartbeat_interval: 45_000 } });
    await settled();
    emit(connection.observer, {
      op: 0,
      s: 1,
      t: "READY",
      d: { session_id: "gateway-session", resume_gateway_url: "wss://gateway.discord.gg" },
    });
    await settled();
    emit(connection.observer, { op: 0, s: 2, t: "MESSAGE_CREATE", d: { id: "message-1" } });
    emit(connection.observer, { op: 0, s: 3, t: "INTERACTION_CREATE", d: { id: "goal-1" } });
    await settled();
    expect(
      setup.dispatches.map((item) => JSON.parse(Buffer.from(item.body).toString("utf8")).t),
    ).toEqual(["INTERACTION_CREATE"]);
    await expect(
      setup.driver.verifyDispatch({
        sessionHandle: setup.dispatches[0]!.sessionHandle,
        applicationId: "999999999999999999",
        sequence: 3,
        eventName: "INTERACTION_CREATE",
        verifiedAt: "2026-09-07T09:00:00.000Z",
      }),
    ).resolves.toEqual({ authenticated: true });
    finishReady();
    await settled();
    expect(setup.dispatches).toHaveLength(2);
    setup.schedule.runNext();
    expect(JSON.parse(connection.sent.at(-1)!)).toEqual({ op: 1, d: 3 });
    setup.driver.stop();
  });

  it("identifies, authenticates READY, and forwards a verifiable dispatch", async () => {
    const setup = fixture();
    setup.driver.start();
    const connection = setup.transport.connections[0]!;

    emit(connection.observer, { op: 10, d: { heartbeat_interval: 45_000 } });
    await settled();
    expect(setup.schedule.delays[0]).toBe(11_250);
    expect(JSON.parse(connection.sent[0]!)).toMatchObject({
      op: 2,
      d: { token: expect.any(String), intents: 37_377 },
    });

    emit(connection.observer, {
      op: 0,
      s: 1,
      t: "READY",
      d: { session_id: "gateway-session", resume_gateway_url: "wss://gateway.discord.gg" },
    });
    emit(connection.observer, {
      op: 0,
      s: 2,
      t: "MESSAGE_CREATE",
      d: { id: "message-1" },
    });
    await settled();

    expect(setup.ready).toHaveBeenCalledOnce();
    expect(setup.dispatches).toHaveLength(1);
    expect(setup.verified).toHaveBeenCalledWith({ authenticated: true });
    await expect(
      setup.driver.verifyDispatch({
        sessionHandle: setup.dispatches[0]!.sessionHandle,
        applicationId: "999999999999999999",
        sequence: 2,
        eventName: "MESSAGE_CREATE",
        verifiedAt: "2026-09-07T09:00:00.000Z",
      }),
    ).resolves.toEqual({
      authenticated: false,
      reasonCode: "gateway_dispatch_unverified",
    });
    await expect(
      setup.driver.verifyDispatch({
        sessionHandle: setup.dispatches[0]!.sessionHandle,
        applicationId: "000000000000000000",
        sequence: 2,
        eventName: "MESSAGE_CREATE",
        verifiedAt: "2026-09-07T09:00:00.000Z",
      }),
    ).resolves.toEqual({
      authenticated: false,
      reasonCode: "gateway_dispatch_unverified",
    });
  });

  it("accepts an official regional Discord resume host", async () => {
    const setup = fixture();
    setup.driver.start();
    const connection = setup.transport.connections[0]!;

    emit(connection.observer, { op: 10, d: { heartbeat_interval: 45_000 } });
    emit(connection.observer, {
      op: 0,
      s: 1,
      t: "READY",
      d: {
        session_id: "gateway-session",
        resume_gateway_url: "wss://gateway-us-east1-b.discord.gg",
      },
    });
    await settled();

    expect(setup.ready).toHaveBeenCalledOnce();
  });

  it("rejects a resume host outside the configured Discord trust boundary", async () => {
    const onError = vi.fn();
    const setup = fixture(undefined, onError);
    setup.driver.start();
    const connection = setup.transport.connections[0]!;

    emit(connection.observer, { op: 10, d: { heartbeat_interval: 45_000 } });
    emit(connection.observer, {
      op: 0,
      s: 1,
      t: "READY",
      d: { session_id: "gateway-session", resume_gateway_url: "wss://discord.example" },
    });
    await settled();

    expect(setup.ready).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "authentication_failed" }),
    );
  });

  it("waits for asynchronous READY observation before forwarding dispatches", async () => {
    let releaseReady!: () => void;
    const readyGate = new Promise<void>((resolve) => {
      releaseReady = resolve;
    });
    const setup = fixture(() => readyGate);
    setup.driver.start();
    const connection = setup.transport.connections[0]!;

    emit(connection.observer, { op: 10, d: { heartbeat_interval: 45_000 } });
    emit(connection.observer, {
      op: 0,
      s: 1,
      t: "READY",
      d: { session_id: "gateway-session", resume_gateway_url: "wss://gateway.discord.gg" },
    });
    emit(connection.observer, {
      op: 0,
      s: 2,
      t: "MESSAGE_CREATE",
      d: { id: "message-1" },
    });
    await settled();

    expect(setup.ready).toHaveBeenCalledOnce();
    expect(setup.dispatches).toHaveLength(0);
    releaseReady();
    await settled();
    expect(setup.dispatches).toHaveLength(1);
  });

  it("keeps the authenticated session when READY application work fails", async () => {
    const onError = vi.fn();
    const cause = new Error("history reconciliation unavailable");
    const setup = fixture(async () => Promise.reject(cause), onError);
    setup.driver.start();
    const connection = setup.transport.connections[0]!;

    emit(connection.observer, { op: 10, d: { heartbeat_interval: 45_000 } });
    emit(connection.observer, {
      op: 0,
      s: 1,
      t: "READY",
      d: { session_id: "gateway-session", resume_gateway_url: "wss://gateway.discord.gg" },
    });
    await settled();
    emit(connection.observer, {
      op: 0,
      s: 2,
      t: "MESSAGE_CREATE",
      d: { id: "message-after-ready-failure" },
    });
    await settled();

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "dispatch_failed", cause }),
    );
    expect(connection.close).not.toHaveBeenCalled();
    expect(setup.transport.connections).toHaveLength(1);
    expect(setup.dispatches).toHaveLength(1);
  });

  it("reconnects and resumes after a missed heartbeat acknowledgement", async () => {
    const setup = fixture();
    setup.driver.start();
    const first = setup.transport.connections[0]!;
    emit(first.observer, { op: 10, d: { heartbeat_interval: 45_000 } });
    emit(first.observer, {
      op: 0,
      s: 12,
      t: "READY",
      d: { session_id: "gateway-session", resume_gateway_url: "wss://gateway.discord.gg" },
    });
    await settled();

    setup.schedule.runNext();
    expect(JSON.parse(first.sent.at(-1)!)).toEqual({ op: 1, d: 12 });
    setup.schedule.runNext();
    expect(first.close).toHaveBeenCalledOnce();
    setup.schedule.runNext();
    const resumed = setup.transport.connections[1]!;
    emit(resumed.observer, { op: 10, d: { heartbeat_interval: 45_000 } });
    await settled();

    expect(JSON.parse(resumed.sent[0]!)).toEqual({
      op: 6,
      d: { token: `discord.${"t".repeat(40)}`, session_id: "gateway-session", seq: 12 },
    });
  });

  it("keeps heartbeat control responsive while ordered application dispatch is still running", async () => {
    const transport = new FixtureTransport();
    const schedule = new FixtureSchedule();
    let releaseFirst!: () => void;
    const firstPending = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const dispatches: Array<{ sessionHandle: string; body: Uint8Array }> = [];
    const verified: Array<{ authenticated: boolean }> = [];
    const driver = new AuthenticatedDiscordGatewayDriver({
      applicationId: "999999999999999999",
      botToken: `discord.${"t".repeat(40)}`,
      intents: 37_377,
      transport,
      schedule,
      reconnectDelayMs: 100,
      heartbeatJitter: () => 0.25,
      createSessionHandle: () => `discord_session_${transport.connections.length + 1}`,
      async onDispatch(dispatch) {
        dispatches.push(dispatch);
        if (dispatches.length === 1) await firstPending;
        const payload = JSON.parse(Buffer.from(dispatch.body).toString("utf8")) as {
          s: number;
          t: string;
        };
        verified.push(
          await driver.verifyDispatch({
            sessionHandle: dispatch.sessionHandle,
            applicationId: "999999999999999999",
            sequence: payload.s,
            eventName: payload.t,
            verifiedAt: "2026-09-07T09:00:00.000Z",
          }),
        );
      },
    });
    driver.start();
    const connection = transport.connections[0]!;
    emit(connection.observer, { op: 10, d: { heartbeat_interval: 45_000 } });
    emit(connection.observer, {
      op: 0,
      s: 1,
      t: "READY",
      d: { session_id: "gateway-session", resume_gateway_url: "wss://gateway.discord.gg" },
    });
    emit(connection.observer, { op: 0, s: 2, t: "MESSAGE_CREATE", d: { id: "message-1" } });
    await settled();
    expect(dispatches).toHaveLength(1);

    schedule.runNext();
    expect(JSON.parse(connection.sent.at(-1)!)).toEqual({ op: 1, d: 2 });
    emit(connection.observer, { op: 11, d: null });
    emit(connection.observer, { op: 0, s: 3, t: "MESSAGE_CREATE", d: { id: "message-2" } });
    await settled();
    schedule.runNext();

    expect(connection.close).not.toHaveBeenCalled();
    expect(JSON.parse(connection.sent.at(-1)!)).toEqual({ op: 1, d: 3 });
    expect(dispatches).toHaveLength(1);
    releaseFirst();
    await settled();
    await settled();
    expect(dispatches).toHaveLength(2);
    expect(verified).toEqual([{ authenticated: true }, { authenticated: true }]);
    driver.stop();
  });

  it("stops reconnecting after a terminal authentication close", () => {
    const onError = vi.fn();
    const transport = new FixtureTransport();
    const schedule = new FixtureSchedule();
    const driver = new AuthenticatedDiscordGatewayDriver({
      applicationId: "999999999999999999",
      botToken: `discord.${"t".repeat(40)}`,
      intents: 37_377,
      transport,
      schedule,
      reconnectDelayMs: 100,
      onDispatch: () => undefined,
      onError,
    });
    driver.start();

    transport.connections[0]!.observer.close(4004, "authentication failed");

    expect(schedule.tasks.size).toBe(0);
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "authentication_failed" }),
    );
  });

  it("reconnects when the transport reports an error without a close event", () => {
    const setup = fixture();
    setup.driver.start();

    setup.transport.connections[0]!.observer.error(new Error("socket failed"));

    expect(setup.transport.connections[0]!.close).toHaveBeenCalledOnce();
    setup.schedule.runNext();
    expect(setup.transport.connections).toHaveLength(2);

    setup.transport.connections[0]!.observer.close(1006, "late close");
    expect(setup.schedule.tasks.size).toBe(0);
  });
});

describe("Discord conversation intents", () => {
  it("requires message content and only the configured address scopes", () => {
    const guildOnly = requiredDiscordConversationIntents({
      guildMessages: true,
      directMessages: false,
    });
    expect(guildOnly).toBe(33_281);
    expect(includesDiscordGatewayIntents(37_377, guildOnly)).toBe(true);
    expect(includesDiscordGatewayIntents(513, guildOnly)).toBe(false);
  });
});
