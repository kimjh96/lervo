import { type ServerResponse } from "node:http";

export const DEFAULT_HUB_HTTP_MAX_RESPONSE_BYTES = 1_048_576;
export const MAX_HUB_HTTP_MAX_RESPONSE_BYTES = 16_777_216;

export function resolveHubHttpMaxResponseBytes(value: number | undefined): number {
  const resolved = value ?? DEFAULT_HUB_HTTP_MAX_RESPONSE_BYTES;
  if (
    !Number.isSafeInteger(resolved) || resolved < 1_024 ||
    resolved > MAX_HUB_HTTP_MAX_RESPONSE_BYTES
  ) {
    throw new Error(
      `Hub HTTP maxResponseBytes는 1024 이상 ${MAX_HUB_HTTP_MAX_RESPONSE_BYTES} 이하여야 합니다.`,
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
  invalid_request: "요청 형식이 올바르지 않습니다.",
  unauthorized: "인증 정보가 없거나 올바르지 않습니다.",
  forbidden: "이 project에 접근할 권한이 없습니다.",
  not_found: "요청한 API 경로가 없습니다.",
  method_not_allowed: "이 API에서 허용하지 않는 HTTP method입니다.",
  project_not_found: "요청한 project trace가 없습니다.",
  run_not_found: "요청한 run trace가 없습니다.",
  conflict: "요청이 현재 원본 상태와 충돌합니다.",
  request_too_large: "요청 본문이 허용된 크기를 초과했습니다.",
  response_too_large: "응답이 허용된 크기를 초과했습니다.",
  internal_error: "Hub 요청을 처리하는 중 오류가 발생했습니다.",
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
