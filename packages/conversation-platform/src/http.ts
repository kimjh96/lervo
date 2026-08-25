import { ConversationPlatformError } from "./types.js";
import { PlatformDeliveryRejectedError } from "./delivery-replay.js";

const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;

export interface PlatformJsonRequestOptions {
  url: string;
  headers: Readonly<Record<string, string>>;
  body: unknown;
  fetch?: typeof globalThis.fetch;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
  allowInsecureHttpForTests?: boolean;
}

export function assertPlatformHttpLimits(input: {
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
}): void {
  const maximum = input.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeoutMs = input.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1_024 ||
    maximum > 4 * 1024 * 1024 ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 300_000
  ) {
    throw new ConversationPlatformError(
      "invalid_platform_configuration",
      "The platform API response-size or request-timeout setting is invalid.",
    );
  }
}

export function platformApiUrl(value: string, allowInsecureHttpForTests = false): URL {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && !(allowInsecureHttpForTests && url.protocol === "http:")) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new ConversationPlatformError(
      "invalid_platform_configuration",
      "The platform API address must be an HTTPS URL without credentials, a query, or a fragment.",
    );
  }
  return url;
}

export async function postPlatformJson(options: PlatformJsonRequestOptions): Promise<unknown> {
  const maximum = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_TIMEOUT_MS;
  assertPlatformHttpLimits(options);
  const url = platformApiUrl(options.url, options.allowInsecureHttpForTests);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetch ?? globalThis.fetch)(url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json; charset=utf-8",
        ...options.headers,
      },
      body: JSON.stringify(options.body),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new PlatformDeliveryRejectedError();
    }
    if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
      await response.body?.cancel();
      throw new Error("Platform API response content type mismatch");
    }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > maximum)) {
      await response.body?.cancel();
      throw new Error("Platform API response size mismatch");
    }
    if (response.body === null) throw new Error("Platform API response body missing");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let byteCount = 0;
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteCount += chunk.value.byteLength;
      if (byteCount > maximum) {
        await reader.cancel();
        throw new Error("Platform API response too large");
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(byteCount);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const value: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return value;
  } catch (error) {
    if (error instanceof PlatformDeliveryRejectedError) throw error;
    throw new ConversationPlatformError(
      "platform_delivery_failed",
      "The platform API response could not be verified safely.",
      { cause: error instanceof Error ? error : undefined },
    );
  } finally {
    clearTimeout(timeout);
  }
}
