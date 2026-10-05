import { readSyncHttpJson } from "./http-json.js";

const DEFAULT_MAX_REQUEST_BYTES = 4_194_304;
const MAXIMUM_HTTP_BYTES = 16_777_216;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export type HubJsonCredentialMode = "bearer" | "none";

export interface HubJsonHttpClientOptions {
  bearerToken?: string;
  expectedHubIdentityHash: string;
  destinationId: string;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

export interface HubJsonHttpRequest {
  signal?: AbortSignal;
  url: URL;
  method: "GET" | "POST";
  body?: unknown;
  acceptedStatuses: readonly number[];
  credentialMode: HubJsonCredentialMode;
}

function byteLimit(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1_024 || resolved > MAXIMUM_HTTP_BYTES) {
    throw new Error(`${label} must be between 1024 and 16777216.`);
  }
  return resolved;
}

function credentialHeaders(mode: HubJsonCredentialMode, bearerToken: string | undefined) {
  switch (mode) {
    case "bearer":
      if (bearerToken === undefined) {
        throw new Error("The Hub JSON HTTP request requires a bearer credential.");
      }
      return { authorization: `Bearer ${bearerToken}` };
    case "none":
      return {};
    default:
      throw new Error("The Hub JSON HTTP credential mode is invalid.");
  }
}

/** A Hub answer whose status the request did not accept; callers may classify `status`. */
export class HubJsonHttpStatusError extends Error {
  constructor(readonly status: number) {
    super("The Hub synchronization response status is invalid.");
    this.name = "HubJsonHttpStatusError";
  }
}

export class HubJsonHttpClient {
  private readonly bearerToken: string | undefined;
  private readonly expectedHubIdentityHash: string;
  private readonly destinationId: string;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly request: typeof globalThis.fetch;

  constructor(options: HubJsonHttpClientOptions) {
    if (
      (options.bearerToken !== undefined &&
        (options.bearerToken.length < 32 ||
          options.bearerToken.length > 4_096 ||
          !/^[\x21-\x7e]+$/.test(options.bearerToken))) ||
      !HASH_PATTERN.test(options.expectedHubIdentityHash) ||
      !DESTINATION_PATTERN.test(options.destinationId)
    ) {
      throw new Error("The Hub synchronization HTTP transport configuration is invalid.");
    }
    this.bearerToken = options.bearerToken;
    this.expectedHubIdentityHash = options.expectedHubIdentityHash;
    this.destinationId = options.destinationId;
    this.maxRequestBytes = byteLimit(
      options.maxRequestBytes,
      DEFAULT_MAX_REQUEST_BYTES,
      "Hub synchronization HTTP request limit",
    );
    this.maxResponseBytes = byteLimit(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "Hub synchronization HTTP response limit",
    );
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 10 ||
      this.requestTimeoutMs > 300_000
    ) {
      throw new Error("The Hub synchronization HTTP request timeout is invalid.");
    }
    this.request = options.fetch ?? globalThis.fetch;
  }

  async requestJson(request: HubJsonHttpRequest): Promise<unknown> {
    const serialized = request.body === undefined ? undefined : JSON.stringify(request.body);
    if (serialized !== undefined && Buffer.byteLength(serialized, "utf8") > this.maxRequestBytes) {
      throw new Error("The Hub synchronization request exceeds the allowed size.");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.request(request.url, {
        method: request.method,
        headers: {
          accept: "application/json",
          ...credentialHeaders(request.credentialMode, this.bearerToken),
          ...(serialized === undefined
            ? {}
            : { "content-type": "application/json; charset=utf-8" }),
        },
        ...(serialized === undefined ? {} : { body: serialized }),
        redirect: "error",
        signal:
          request.signal === undefined
            ? controller.signal
            : AbortSignal.any([controller.signal, request.signal]),
      });
      if (!request.acceptedStatuses.includes(response.status)) {
        await response.body?.cancel();
        throw new HubJsonHttpStatusError(response.status);
      }
      if (response.headers.get("x-lervo-hub-identity") !== this.expectedHubIdentityHash) {
        await response.body?.cancel();
        return {
          authentication: {
            status: "unverified",
            destinationId: this.destinationId,
            peerIdentityHash: null,
          },
          body: null,
        };
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        await response.body?.cancel();
        throw new Error("The Hub synchronization response content type is invalid.");
      }
      return {
        authentication: {
          status: "verified",
          destinationId: this.destinationId,
          peerIdentityHash: this.expectedHubIdentityHash,
        },
        body: await readSyncHttpJson(response, this.maxResponseBytes),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
