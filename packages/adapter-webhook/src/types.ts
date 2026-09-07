import type { AuthenticatedLiveTriggerObservationV1 } from "@lervo/live-trigger-contract";

export interface LiveWebhookCredentialSource {
  load(credentialId: string): Promise<Uint8Array>;
}

export interface LiveWebhookRequestV1 {
  method: string;
  path: string;
  headers: Readonly<Record<string, string | undefined>>;
  body: Uint8Array;
  receivedAt: string;
}

export interface LiveWebhookAdapterOptions {
  sourceId: string;
  credentialId: string;
  expectedPath: string;
  credentialSource: LiveWebhookCredentialSource;
  maximumBodyBytes?: number;
  maximumClockSkewMs?: number;
}

export interface LiveWebhookRequestHandler {
  handle(request: LiveWebhookRequestV1): Promise<{
    statusCode: number;
    body: Record<string, unknown>;
  }>;
}

export interface LiveWebhookServer {
  readonly host: string;
  readonly port: number;
  readonly closed: Promise<void>;
  close(): Promise<void>;
}

export interface LiveWebhookServerOptions {
  host: "127.0.0.1" | "::1";
  port: number;
  maximumBodyBytes: number;
  maximumConcurrentRequests?: number;
  once?: boolean;
  handler: LiveWebhookRequestHandler;
}

export interface LiveWebhookAdapter {
  authenticate(request: LiveWebhookRequestV1): Promise<AuthenticatedLiveTriggerObservationV1>;
}

export class LiveWebhookError extends Error {
  constructor(
    readonly code:
      | "authentication_failed"
      | "body_too_large"
      | "credential_unavailable"
      | "invalid_request"
      | "method_not_allowed"
      | "path_not_found"
      | "request_expired"
      | "server_failed",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LiveWebhookError";
  }
}
