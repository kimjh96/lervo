import { type ServerResponse } from "node:http";

export const DEFAULT_HUB_HTTP_MAX_RESPONSE_BYTES = 1_048_576;
export const MAX_HUB_HTTP_MAX_RESPONSE_BYTES = 16_777_216;

export function resolveHubHttpMaxResponseBytes(value: number | undefined): number {
  const resolved = value ?? DEFAULT_HUB_HTTP_MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(resolved) ||
    resolved < 1_024 ||
    resolved > MAX_HUB_HTTP_MAX_RESPONSE_BYTES
  ) {
    throw new Error(
      `Hub HTTP maxResponseBytes must be between 1024 and ${MAX_HUB_HTTP_MAX_RESPONSE_BYTES}.`,
    );
  }
  return resolved;
}

export type HubHttpErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "method_not_allowed"
  | "project_not_found"
  | "run_not_found"
  | "conflict"
  | "request_too_large"
  | "response_too_large"
  | "internal_error";

const errorMessages: Record<HubHttpErrorCode, string> = {
  invalid_request: "The request format is invalid.",
  unauthorized: "Authentication credentials are missing or invalid.",
  forbidden: "The credential cannot access this project.",
  not_found: "The requested API route does not exist.",
  method_not_allowed: "This API does not allow the requested HTTP method.",
  project_not_found: "The requested project trace does not exist.",
  run_not_found: "The requested run trace does not exist.",
  conflict: "The request conflicts with the current source state.",
  request_too_large: "The request body exceeds the allowed size.",
  response_too_large: "The response exceeds the allowed size.",
  internal_error: "An error occurred while processing the Hub request.",
};

function headers(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
    ...extra,
  };
}

function serialize(body: unknown): string {
  return JSON.stringify(body);
}

export function sendHubJson(
  response: ServerResponse,
  status: number,
  body: unknown,
  maxResponseBytes: number,
  extraHeaders: Record<string, string> = {},
): void {
  const encoded = serialize(body);
  if (Buffer.byteLength(encoded, "utf8") > maxResponseBytes) {
    sendHubError(response, 500, "response_too_large", maxResponseBytes, extraHeaders);
    return;
  }
  response.writeHead(status, headers(extraHeaders));
  response.end(encoded);
}

export function sendHubError(
  response: ServerResponse,
  status: number,
  code: HubHttpErrorCode,
  maxResponseBytes: number,
  extraHeaders: Record<string, string> = {},
): void {
  const encoded = serialize({
    schemaVersion: 1,
    error: { code, message: errorMessages[code] },
  });
  if (Buffer.byteLength(encoded, "utf8") > maxResponseBytes) {
    response.writeHead(500, headers());
    response.end("{}");
    return;
  }
  response.writeHead(status, headers(extraHeaders));
  response.end(encoded);
}
