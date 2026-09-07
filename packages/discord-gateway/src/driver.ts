import { randomUUID } from "node:crypto";

import type { DiscordGatewayAuthenticationPort } from "@lervo/adapter-discord";

import { NodeDiscordGatewayTransport } from "./websocket-transport.js";
import {
  normalizeDiscordGatewayUrl,
  parseDiscordGatewayPayload,
  parseDiscordReadyData,
  type DiscordGatewayPayload,
} from "./payload.js";
import { isAllowedDiscordGatewayResumeUrl } from "./resume-url.js";
import {
  DiscordGatewayError,
  type DiscordGatewayConnection,
  type DiscordGatewayDriver,
  type DiscordGatewayDriverOptions,
  type DiscordGatewaySchedule,
} from "./types.js";

const TERMINAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012, 4013, 4014]);

const systemSchedule: DiscordGatewaySchedule = {
  schedule(delayMs, callback) {
    return setTimeout(callback, delayMs);
  },
  cancel(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

export class AuthenticatedDiscordGatewayDriver
  implements DiscordGatewayDriver, DiscordGatewayAuthenticationPort
{
  private readonly transport;
  private readonly schedule;
  private readonly initialUrl: URL;
  private readonly reconnectDelayMs: number;
  private readonly maximumPayloadBytes: number;
  private readonly maximumDispatchRecords: number;
  private readonly heartbeatJitter: () => number;
  private readonly createSessionHandle: () => string;
  private connection: DiscordGatewayConnection | null = null;
  private connectionGeneration = 0;
  private heartbeatHandle: unknown;
  private reconnectHandle: unknown;
  private heartbeatAcknowledged = true;
  private stopped = true;
  private identified = false;
  private sequence: number | null = null;
  private sessionId: string | null = null;
  private resumeUrl: URL | null = null;
  private sessionHandle = "";
  private readonly authenticatedDispatches = new Set<string>();
  private dispatchChain = Promise.resolve();

  constructor(private readonly options: DiscordGatewayDriverOptions) {
    if (
      !/^[0-9]{1,32}$/u.test(options.applicationId) ||
      options.botToken.length < 32 ||
      options.botToken.length > 4_096 ||
      !Number.isSafeInteger(options.intents) ||
      options.intents < 0 ||
      options.intents > 2 ** 31 - 1
    ) {
      throw new DiscordGatewayError(
        "invalid_configuration",
        "The Discord Gateway identity or intents configuration is invalid.",
      );
    }
    this.initialUrl = normalizeDiscordGatewayUrl(options.gatewayUrl ?? "wss://gateway.discord.gg/");
    this.reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
    this.maximumPayloadBytes = options.maximumPayloadBytes ?? 4 * 1024 * 1024;
    this.maximumDispatchRecords = options.maximumDispatchRecords ?? 1_024;
    if (
      !Number.isSafeInteger(this.reconnectDelayMs) ||
      this.reconnectDelayMs < 100 ||
      this.reconnectDelayMs > 60_000 ||
      !Number.isSafeInteger(this.maximumPayloadBytes) ||
      this.maximumPayloadBytes < 1_024 ||
      this.maximumPayloadBytes > 4 * 1024 * 1024 ||
      !Number.isSafeInteger(this.maximumDispatchRecords) ||
      this.maximumDispatchRecords < 16 ||
      this.maximumDispatchRecords > 16_384
    ) {
      throw new DiscordGatewayError(
        "invalid_configuration",
        "The Discord Gateway retry or payload bounds are invalid.",
      );
    }
    this.transport = options.transport ?? new NodeDiscordGatewayTransport();
    this.schedule = options.schedule ?? systemSchedule;
    this.heartbeatJitter = options.heartbeatJitter ?? Math.random;
    this.createSessionHandle =
      options.createSessionHandle ?? (() => `discord_${randomUUID().replaceAll("-", "")}`);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.connect(this.resumeUrl ?? this.initialUrl);
  }

  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelTimers();
    const connection = this.connection;
    this.connection = null;
    this.connectionGeneration += 1;
    connection?.close(1000, "Lervo Discord Gateway shutdown");
    this.identified = false;
    this.authenticatedDispatches.clear();
  }

  async verifyDispatch(
    input: Parameters<DiscordGatewayAuthenticationPort["verifyDispatch"]>[0],
  ): Promise<{ authenticated: true } | { authenticated: false; reasonCode: string }> {
    const key = `${input.sessionHandle}\0${input.sequence}\0${input.eventName}`;
    if (
      this.stopped ||
      !this.identified ||
      input.applicationId !== this.options.applicationId ||
      !this.authenticatedDispatches.has(key) ||
      !Number.isFinite(Date.parse(input.verifiedAt))
    ) {
      return { authenticated: false, reasonCode: "gateway_dispatch_unverified" };
    }
    return { authenticated: true };
  }

  private connect(url: URL): void {
    if (this.stopped) return;
    const generation = ++this.connectionGeneration;
    this.sessionHandle = this.createSessionHandle();
    this.identified = false;
    this.authenticatedDispatches.clear();
    try {
      this.connection = this.transport.connect(url.href, {
        open: () => undefined,
        message: (payload) => {
          if (generation === this.connectionGeneration) this.enqueuePayload(payload);
        },
        close: (code) => this.closed(generation, code),
        error: (error) => this.connectionFailed(generation, error),
      });
    } catch (error) {
      this.report("connection_failed", "Discord Gateway connection could not start.", error);
      this.scheduleReconnect();
    }
  }

  private enqueuePayload(payload: string | Uint8Array): void {
    this.dispatchChain = this.dispatchChain
      .then(() => this.handlePayload(parseDiscordGatewayPayload(payload, this.maximumPayloadBytes)))
      .catch((error: unknown) => {
        if (error instanceof DiscordGatewayError) {
          this.report(error.code, error.message, error);
        } else {
          this.report("gateway_protocol_invalid", "Discord Gateway processing failed.", error);
        }
        this.reconnect(true);
      });
  }

  private async handlePayload(payload: DiscordGatewayPayload): Promise<void> {
    if (typeof payload.s === "number" && Number.isSafeInteger(payload.s) && payload.s >= 0) {
      this.sequence = payload.s;
    }
    if (payload.op === 10) {
      this.hello(payload.d);
      return;
    }
    if (payload.op === 11) {
      this.heartbeatAcknowledged = true;
      return;
    }
    if (payload.op === 1) {
      this.sendHeartbeat();
      return;
    }
    if (payload.op === 7) {
      this.reconnect(false);
      return;
    }
    if (payload.op === 9) {
      if (payload.d !== true) this.clearResumeState();
      this.reconnect(false);
      return;
    }
    if (payload.op !== 0 || typeof payload.t !== "string" || typeof payload.s !== "number") return;
    if (payload.t === "READY") {
      const ready = parseDiscordReadyData(payload.d);
      if (ready === null) {
        throw new DiscordGatewayError(
          "gateway_protocol_invalid",
          "Discord READY did not include resumable session coordinates.",
        );
      }
      const resumeUrl = normalizeDiscordGatewayUrl(ready.resumeGatewayUrl);
      if (!isAllowedDiscordGatewayResumeUrl(this.initialUrl, resumeUrl)) {
        throw new DiscordGatewayError(
          "authentication_failed",
          "Discord READY returned an unexpected resume host.",
        );
      }
      this.sessionId = ready.sessionId;
      this.resumeUrl = resumeUrl;
      this.identified = true;
      await this.options.onReady?.();
      return;
    }
    if (payload.t === "RESUMED") {
      if (this.sessionId === null) {
        throw new DiscordGatewayError(
          "authentication_failed",
          "Discord resumed an unknown session.",
        );
      }
      this.identified = true;
      await this.options.onReady?.();
      return;
    }
    if (!this.identified) return;
    const key = `${this.sessionHandle}\0${payload.s}\0${payload.t}`;
    this.authenticatedDispatches.add(key);
    while (this.authenticatedDispatches.size > this.maximumDispatchRecords) {
      this.authenticatedDispatches.delete(this.authenticatedDispatches.values().next().value!);
    }
    try {
      await this.options.onDispatch({
        sessionHandle: this.sessionHandle,
        body: Buffer.from(JSON.stringify(payload)),
      });
    } catch (error) {
      this.report("dispatch_failed", "Authenticated Discord dispatch handling failed.", error);
    }
  }

  private hello(value: unknown): void {
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      !Number.isSafeInteger((value as { heartbeat_interval?: unknown }).heartbeat_interval) ||
      (value as { heartbeat_interval: number }).heartbeat_interval < 1_000 ||
      (value as { heartbeat_interval: number }).heartbeat_interval > 120_000
    ) {
      throw new DiscordGatewayError(
        "gateway_protocol_invalid",
        "Discord HELLO heartbeat interval is invalid.",
      );
    }
    const interval = (value as { heartbeat_interval: number }).heartbeat_interval;
    this.heartbeatAcknowledged = true;
    this.scheduleHeartbeat(interval, true);
    if (this.sessionId !== null && this.sequence !== null) {
      this.send({
        op: 6,
        d: { token: this.options.botToken, session_id: this.sessionId, seq: this.sequence },
      });
    } else {
      this.send({
        op: 2,
        d: {
          token: this.options.botToken,
          intents: this.options.intents,
          properties: { os: process.platform, browser: "lervo", device: "lervo" },
        },
      });
    }
  }

  private scheduleHeartbeat(interval: number, initial = false): void {
    if (this.heartbeatHandle !== undefined) this.schedule.cancel(this.heartbeatHandle);
    const jitter = initial ? this.heartbeatJitter() : 1;
    if (!Number.isFinite(jitter) || jitter < 0 || jitter > 1) {
      throw new DiscordGatewayError(
        "invalid_configuration",
        "The Discord Gateway heartbeat jitter must be between zero and one.",
      );
    }
    this.heartbeatHandle = this.schedule.schedule(Math.floor(interval * jitter), () => {
      this.heartbeatHandle = undefined;
      if (this.stopped) return;
      if (!this.heartbeatAcknowledged) {
        this.reconnect(false);
        return;
      }
      this.sendHeartbeat();
      this.scheduleHeartbeat(interval);
    });
  }

  private sendHeartbeat(): void {
    this.send({ op: 1, d: this.sequence });
    this.heartbeatAcknowledged = false;
  }

  private send(payload: unknown): void {
    if (this.connection === null) {
      throw new DiscordGatewayError(
        "connection_failed",
        "Discord Gateway connection is unavailable.",
      );
    }
    this.connection.send(JSON.stringify(payload));
  }

  private connectionFailed(generation: number, error: Error): void {
    if (generation !== this.connectionGeneration) return;
    this.report("connection_failed", "Discord Gateway connection failed.", error);
    this.reconnect(false);
  }

  private closed(generation: number, code: number): void {
    if (generation !== this.connectionGeneration) return;
    this.connection = null;
    this.connectionGeneration += 1;
    if (this.stopped) return;
    if (TERMINAL_CLOSE_CODES.has(code)) {
      this.stopped = true;
      this.cancelTimers();
      this.report(
        "authentication_failed",
        "Discord Gateway rejected the configured bot identity or intents.",
      );
      return;
    }
    if (code === 4007 || code === 4009) this.clearResumeState();
    this.scheduleReconnect();
  }

  private reconnect(clearSession: boolean): void {
    if (clearSession) this.clearResumeState();
    const connection = this.connection;
    this.connection = null;
    this.connectionGeneration += 1;
    connection?.close(4000, "Lervo Discord Gateway reconnect");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectHandle !== undefined) return;
    if (this.heartbeatHandle !== undefined) {
      this.schedule.cancel(this.heartbeatHandle);
      this.heartbeatHandle = undefined;
    }
    this.reconnectHandle = this.schedule.schedule(this.reconnectDelayMs, () => {
      this.reconnectHandle = undefined;
      this.connect(this.resumeUrl ?? this.initialUrl);
    });
  }

  private clearResumeState(): void {
    this.sessionId = null;
    this.resumeUrl = null;
    this.sequence = null;
    this.identified = false;
  }

  private cancelTimers(): void {
    if (this.heartbeatHandle !== undefined) this.schedule.cancel(this.heartbeatHandle);
    if (this.reconnectHandle !== undefined) this.schedule.cancel(this.reconnectHandle);
    this.heartbeatHandle = undefined;
    this.reconnectHandle = undefined;
  }

  private report(code: DiscordGatewayError["code"], message: string, cause?: unknown): void {
    this.options.onError?.(
      new DiscordGatewayError(code, message, {
        ...(cause instanceof Error ? { cause } : {}),
      }),
    );
  }
}
