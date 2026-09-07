import { DiscordGatewayError } from "./types.js";

export interface DiscordGatewayPayload {
  op: number;
  d: unknown;
  s?: number | null;
  t?: string | null;
}

export function normalizeDiscordGatewayUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "wss:" || url.username !== "" || url.password !== "" || url.hash !== "") {
    throw new DiscordGatewayError(
      "invalid_configuration",
      "The Discord Gateway URL must be a credential-free WSS URL.",
    );
  }
  url.searchParams.set("v", "10");
  url.searchParams.set("encoding", "json");
  return url;
}

export function parseDiscordGatewayPayload(
  payload: string | Uint8Array,
  maximumBytes: number,
): DiscordGatewayPayload {
  const bytes = typeof payload === "string" ? Buffer.from(payload) : payload;
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    throw new DiscordGatewayError(
      "gateway_protocol_invalid",
      "The Discord Gateway payload size is invalid.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    throw new DiscordGatewayError(
      "gateway_protocol_invalid",
      "The Discord Gateway payload is not valid UTF-8 JSON.",
      { cause: error instanceof Error ? error : undefined },
    );
  }
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !Number.isSafeInteger((value as { op?: unknown }).op)
  ) {
    throw new DiscordGatewayError(
      "gateway_protocol_invalid",
      "The Discord Gateway payload envelope is invalid.",
    );
  }
  return value as DiscordGatewayPayload;
}

export function parseDiscordReadyData(
  value: unknown,
): { sessionId: string; resumeGatewayUrl: string } | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const data = value as { session_id?: unknown; resume_gateway_url?: unknown };
  return typeof data.session_id === "string" &&
    data.session_id.length > 0 &&
    typeof data.resume_gateway_url === "string"
    ? { sessionId: data.session_id, resumeGatewayUrl: data.resume_gateway_url }
    : null;
}
