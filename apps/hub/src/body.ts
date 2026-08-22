import type { IncomingMessage } from "node:http";

import { InvalidHubHttpRequestError } from "./request.js";

export class HubHttpRequestTooLargeError extends Error {}

export async function readBoundedJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<unknown> {
  if (!request.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
    throw new InvalidHubHttpRequestError();
  }
  const length = request.headers["content-length"];
  if (length !== undefined) {
    if (!/^(0|[1-9][0-9]*)$/.test(length)) throw new InvalidHubHttpRequestError();
    if (Number(length) > maxBytes) throw new HubHttpRequestTooLargeError();
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += value.byteLength;
    if (bytes > maxBytes) throw new HubHttpRequestTooLargeError();
    chunks.push(value);
  }
  if (bytes === 0) throw new InvalidHubHttpRequestError();
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    return JSON.parse(text);
  } catch {
    throw new InvalidHubHttpRequestError();
  }
}
