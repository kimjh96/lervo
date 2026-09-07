import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import {
  LiveWebhookError,
  type LiveWebhookServer,
  type LiveWebhookServerOptions,
} from "./types.js";

function headerValue(request: IncomingMessage, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? undefined : value;
}

function respond(
  response: ServerResponse,
  statusCode: number,
  body: Record<string, unknown>,
): void {
  const content = `${JSON.stringify(body)}\n`;
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(content),
    "cache-control": "no-store",
  });
  response.end(content);
}

async function readBody(request: IncomingMessage, maximumBodyBytes: number): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > maximumBodyBytes)
      throw new LiveWebhookError("body_too_large", "The webhook body exceeds its byte limit.");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
}

function errorResponse(error: unknown): { statusCode: number; body: Record<string, unknown> } {
  if (!(error instanceof LiveWebhookError)) {
    return { statusCode: 500, body: { status: "failed", failureCode: "server_failed" } };
  }
  const statusCode =
    error.code === "method_not_allowed"
      ? 405
      : error.code === "path_not_found"
        ? 404
        : error.code === "body_too_large"
          ? 413
          : error.code === "authentication_failed" || error.code === "request_expired"
            ? 401
            : error.code === "credential_unavailable"
              ? 503
              : 400;
  return { statusCode, body: { status: "rejected", failureCode: error.code } };
}

export async function openLiveWebhookServer(
  options: LiveWebhookServerOptions,
): Promise<LiveWebhookServer> {
  const maximumConcurrentRequests = options.maximumConcurrentRequests ?? 16;
  if (
    (options.host !== "127.0.0.1" && options.host !== "::1") ||
    !Number.isSafeInteger(options.port) ||
    options.port < 0 ||
    options.port > 65_535 ||
    !Number.isSafeInteger(options.maximumBodyBytes) ||
    options.maximumBodyBytes < 1 ||
    options.maximumBodyBytes > 1024 * 1024 ||
    !Number.isSafeInteger(maximumConcurrentRequests) ||
    maximumConcurrentRequests < 1 ||
    maximumConcurrentRequests > 256
  ) {
    throw new LiveWebhookError("server_failed", "The webhook server options are invalid.");
  }
  let active = 0;
  let closeRequested = false;
  const server = createServer(async (request, response) => {
    if (active >= maximumConcurrentRequests) {
      respond(response, 503, { status: "rejected", failureCode: "server_capacity" });
      return;
    }
    active += 1;
    try {
      const body = await readBody(request, options.maximumBodyBytes);
      const result = await options.handler.handle({
        method: request.method ?? "",
        path: new URL(request.url ?? "/", "http://localhost").pathname,
        headers: {
          "x-lervo-event-id": headerValue(request, "x-lervo-event-id"),
          "x-lervo-event-type": headerValue(request, "x-lervo-event-type"),
          "x-lervo-signature": headerValue(request, "x-lervo-signature"),
          "x-lervo-timestamp": headerValue(request, "x-lervo-timestamp"),
        },
        body,
        receivedAt: new Date().toISOString(),
      });
      respond(response, result.statusCode, result.body);
    } catch (error) {
      const result = errorResponse(error);
      respond(response, result.statusCode, result.body);
    } finally {
      active -= 1;
      if (options.once && !closeRequested) {
        closeRequested = true;
        server.close();
      }
    }
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    server.close();
    throw new LiveWebhookError("server_failed", "The webhook server address is unavailable.");
  }
  let closePromise: Promise<void> | undefined;
  const close = () => {
    closePromise ??= new Promise<void>((resolve, reject) => {
      if (!server.listening) {
        resolve();
        return;
      }
      server.close((error?: Error) => (error === undefined ? resolve() : reject(error)));
    });
    return closePromise;
  };
  return {
    host: options.host,
    port: address.port,
    closed: new Promise<void>((resolve, reject) => {
      server.once("close", resolve);
      server.once("error", reject);
    }),
    close,
  };
}
