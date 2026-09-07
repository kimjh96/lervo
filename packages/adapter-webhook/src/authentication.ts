import { createHmac, timingSafeEqual } from "node:crypto";

import {
  liveTriggerBytesHash,
  liveTriggerDescriptorHash,
  liveTriggerHash,
  type AuthenticatedLiveTriggerObservationV1,
  type LiveTriggerAdapterDescriptorV1,
} from "@lervo/live-trigger-contract";

import {
  LiveWebhookError,
  type LiveWebhookAdapter,
  type LiveWebhookAdapterOptions,
  type LiveWebhookRequestV1,
} from "./types.js";

const adapterMaterial: Omit<LiveTriggerAdapterDescriptorV1, "descriptorHash"> = {
  schemaVersion: 1,
  adapterId: "lervo.webhook.hmac-sha256",
  adapterVersion: "1.0.0",
  authentication: "hmac_sha256",
  replayProtection: "source_event_key",
  externalIdentifiers: "hashed_only",
  capabilities: ["assignment_routine.invoke"],
};

export const liveWebhookAdapterDescriptor: LiveTriggerAdapterDescriptorV1 = {
  ...adapterMaterial,
  descriptorHash: liveTriggerDescriptorHash(adapterMaterial),
};

const EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u;
const EVENT_TYPE = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const SIGNATURE = /^v1=([a-f0-9]{64})$/u;

function header(request: LiveWebhookRequestV1, name: string): string {
  const value = request.headers[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new LiveWebhookError("invalid_request", `The ${name} header is required.`);
  }
  return value;
}

function signingBytes(input: {
  timestamp: string;
  eventId: string;
  eventType: string;
  body: Uint8Array;
}): Uint8Array {
  return Buffer.concat([
    Buffer.from(`${input.timestamp}.${input.eventId}.${input.eventType}.`, "utf8"),
    input.body,
  ]);
}

export function createLiveWebhookSignature(input: {
  secret: Uint8Array;
  timestamp: string;
  eventId: string;
  eventType: string;
  body: Uint8Array;
}): string {
  return `v1=${createHmac("sha256", input.secret).update(signingBytes(input)).digest("hex")}`;
}

export function createLiveWebhookAdapter(options: LiveWebhookAdapterOptions): LiveWebhookAdapter {
  const maximumBodyBytes = options.maximumBodyBytes ?? 64 * 1024;
  const maximumClockSkewMs = options.maximumClockSkewMs ?? 300_000;
  if (
    !EVENT_TYPE.test(options.sourceId) ||
    !EVENT_TYPE.test(options.credentialId) ||
    !options.expectedPath.startsWith("/") ||
    options.expectedPath.length > 256 ||
    !Number.isSafeInteger(maximumBodyBytes) ||
    maximumBodyBytes < 1 ||
    maximumBodyBytes > 1024 * 1024 ||
    !Number.isSafeInteger(maximumClockSkewMs) ||
    maximumClockSkewMs < 1 ||
    maximumClockSkewMs > 15 * 60_000
  ) {
    throw new LiveWebhookError("invalid_request", "The live webhook adapter options are invalid.");
  }
  return {
    async authenticate(request): Promise<AuthenticatedLiveTriggerObservationV1> {
      if (request.method !== "POST")
        throw new LiveWebhookError(
          "method_not_allowed",
          "Only POST webhook requests are accepted.",
        );
      if (request.path !== options.expectedPath)
        throw new LiveWebhookError("path_not_found", "The webhook request path is not registered.");
      if (request.body.byteLength > maximumBodyBytes)
        throw new LiveWebhookError("body_too_large", "The webhook body exceeds its byte limit.");
      if (!Number.isFinite(Date.parse(request.receivedAt)))
        throw new LiveWebhookError("invalid_request", "The webhook receive time is invalid.");
      const timestamp = header(request, "x-lervo-timestamp");
      const eventId = header(request, "x-lervo-event-id");
      const eventType = header(request, "x-lervo-event-type");
      const signature = header(request, "x-lervo-signature");
      if (!/^\d{10}$/u.test(timestamp) || !EVENT_ID.test(eventId) || !EVENT_TYPE.test(eventType))
        throw new LiveWebhookError("invalid_request", "The webhook source headers are invalid.");
      const occurredAtMs = Number(timestamp) * 1000;
      const receivedAtMs = Date.parse(request.receivedAt);
      if (Math.abs(receivedAtMs - occurredAtMs) > maximumClockSkewMs)
        throw new LiveWebhookError(
          "request_expired",
          "The webhook timestamp is outside the allowed window.",
        );
      const match = SIGNATURE.exec(signature);
      if (match === null)
        throw new LiveWebhookError("authentication_failed", "Webhook authentication failed.");
      let secret: Uint8Array;
      try {
        secret = await options.credentialSource.load(options.credentialId);
      } catch (error) {
        throw new LiveWebhookError(
          "credential_unavailable",
          "The webhook credential is unavailable.",
          { cause: error },
        );
      }
      if (secret.byteLength < 32 || secret.byteLength > 4096)
        throw new LiveWebhookError("credential_unavailable", "The webhook credential is invalid.");
      try {
        const signed = signingBytes({ timestamp, eventId, eventType, body: request.body });
        const expected = createHmac("sha256", secret).update(signed).digest();
        const supplied = Buffer.from(match[1]!, "hex");
        if (expected.byteLength !== supplied.byteLength || !timingSafeEqual(expected, supplied))
          throw new LiveWebhookError("authentication_failed", "Webhook authentication failed.");
        const occurredAt = new Date(occurredAtMs).toISOString();
        const sourceEventKeyHash = liveTriggerHash({ sourceId: options.sourceId, eventId });
        const requestContentHash = liveTriggerBytesHash(request.body);
        return {
          schemaVersion: 1,
          kind: "authenticated_webhook",
          descriptor: structuredClone(liveWebhookAdapterDescriptor),
          sourceId: options.sourceId,
          credentialId: options.credentialId,
          eventType,
          sourceEventKeyHash,
          requestContentHash,
          authenticationReceiptHash: liveTriggerHash({
            descriptorHash: liveWebhookAdapterDescriptor.descriptorHash,
            sourceId: options.sourceId,
            credentialId: options.credentialId,
            sourceEventKeyHash,
            requestContentHash,
            signingInputHash: liveTriggerBytesHash(signed),
          }),
          occurredAt,
          authenticatedAt: request.receivedAt,
        };
      } finally {
        secret.fill(0);
      }
    },
  };
}
