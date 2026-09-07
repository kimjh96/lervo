import type {
  DiscordGatewayAuthenticationPort,
  DiscordGatewayDispatch,
} from "@lervo/adapter-discord";

export interface DiscordGatewayConnection {
  send(payload: string): void;
  close(code?: number, reason?: string): void;
}

export interface DiscordGatewayConnectionObserver {
  open(): void;
  message(payload: string | Uint8Array): void;
  close(code: number, reason: string): void;
  error(error: Error): void;
}

export interface DiscordGatewayTransport {
  connect(url: string, observer: DiscordGatewayConnectionObserver): DiscordGatewayConnection;
}

export interface DiscordGatewaySchedule {
  schedule(delayMs: number, callback: () => void): unknown;
  cancel(handle: unknown): void;
}

export interface DiscordGatewayDriverOptions {
  applicationId: string;
  botToken: string;
  intents: number;
  onDispatch(dispatch: DiscordGatewayDispatch): void | Promise<void>;
  onReady?(): void | Promise<void>;
  onError?(error: Error): void;
  gatewayUrl?: string;
  reconnectDelayMs?: number;
  maximumPayloadBytes?: number;
  maximumDispatchRecords?: number;
  transport?: DiscordGatewayTransport;
  schedule?: DiscordGatewaySchedule;
  heartbeatJitter?: () => number;
  createSessionHandle?: () => string;
}

export interface DiscordGatewayDriver extends DiscordGatewayAuthenticationPort {
  start(): void;
  stop(): void;
}

export class DiscordGatewayError extends Error {
  constructor(
    readonly code:
      | "invalid_configuration"
      | "connection_failed"
      | "gateway_protocol_invalid"
      | "authentication_failed"
      | "dispatch_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DiscordGatewayError";
  }
}
