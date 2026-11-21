import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

import { HubJsonHttpStatusError } from "./hub-json-http-client.js";

/**
 * ADR-0602: how long a held connection may be silent before the kernel probes it. Probes are TCP
 * keepalive segments the kernel sends and answers on its own; they never wake the process.
 */
export const HUB_HELD_REQUEST_KEEPALIVE_MILLISECONDS = 15_000;
const MAXIMUM_HELD_RESPONSE_BYTES = 4_096;
/**
 * ADR-0602: the Hub answers an open hold within ten minutes; a request still unanswered this long
 * after it was sent lost its connection somewhere a keepalive cannot see (a proxy hop), so it is
 * ended and the caller reconnects. A legacy hold is answered within 25 seconds.
 */
export const HUB_OPEN_HOLD_DEADLINE_MILLISECONDS = 10 * 60_000 + 60_000;
export const HUB_LEGACY_HOLD_DEADLINE_MILLISECONDS = 25_000 + 60_000;
const utf8 = new TextDecoder("utf-8", { fatal: true });

/** The same result shape HubJsonHttpClient.requestJson returns. */
export type HubHeldResult =
  | {
      authentication: { status: "verified"; destinationId: string; peerIdentityHash: string };
      body: unknown;
    }
  | {
      authentication: { status: "unverified"; destinationId: string; peerIdentityHash: null };
      body: null;
    };

function readBody(response: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declared = response.headers["content-length"];
    if (
      declared !== undefined &&
      (!/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) > MAXIMUM_HELD_RESPONSE_BYTES)
    ) {
      response.destroy();
      reject(new Error("The Hub change response size is invalid."));
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    response.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAXIMUM_HELD_RESPONSE_BYTES) {
        response.destroy(new Error("The Hub change response exceeds the allowed size."));
        return;
      }
      chunks.push(chunk);
    });
    let ended = false;
    response.once("error", reject);
    response.once("close", () => {
      if (!ended) reject(new Error("The Hub change response ended early."));
    });
    response.once("end", () => {
      ended = true;
      try {
        resolve(JSON.parse(utf8.decode(Buffer.concat(chunks))));
      } catch {
        reject(new Error("The Hub change response is not UTF-8 JSON."));
      }
    });
  });
}

/**
 * ADR-0602: one GET the Hub holds until something changes or its hold bound. Unlike fetch, whose
 * header and body timeouts end a silent request after five minutes, it arms one deadline per
 * request, just past the Hub's bound: TCP keepalive notices a vanished first hop at once, and the
 * deadline a connection dropped silently further along. `signal` ends it on the caller's side.
 * The identity, status and content checks match HubJsonHttpClient.
 */
export function holdHubRequest(input: {
  url: URL;
  bearerToken: string;
  expectedHubIdentityHash: string;
  destinationId: string;
  signal: AbortSignal;
  deadlineMilliseconds?: number;
}): Promise<HubHeldResult> {
  return new Promise<HubHeldResult>((resolve, reject) => {
    if (input.signal.aborted) {
      reject(input.signal.reason);
      return;
    }
    const send = input.url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = send(input.url, {
      method: "GET",
      // A connection of its own: the keepalive setting and the indefinite hold stay off the pool.
      agent: false,
      headers: { accept: "application/json", authorization: `Bearer ${input.bearerToken}` },
    });
    const abort = () => request.destroy(input.signal.reason as Error);
    input.signal.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(
      () =>
        request.destroy(
          Object.assign(new Error("The Hub held request outlived its bound."), {
            code: "ERR_HUB_HOLD_DEADLINE",
          }),
        ),
      input.deadlineMilliseconds ?? HUB_OPEN_HOLD_DEADLINE_MILLISECONDS,
    );
    deadline.unref();
    const settle = () => {
      clearTimeout(deadline);
      input.signal.removeEventListener("abort", abort);
    };
    request.once("socket", (socket) => {
      socket.setKeepAlive(true, HUB_HELD_REQUEST_KEEPALIVE_MILLISECONDS);
      socket.setNoDelay(true);
    });
    request.once("error", (error) => {
      settle();
      reject(error);
    });
    request.once("response", (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        settle();
        reject(new HubJsonHttpStatusError(response.statusCode ?? 0));
        return;
      }
      if (response.headers["x-lervo-hub-identity"] !== input.expectedHubIdentityHash) {
        response.resume();
        settle();
        resolve({
          authentication: {
            status: "unverified",
            destinationId: input.destinationId,
            peerIdentityHash: null,
          },
          body: null,
        });
        return;
      }
      if (!response.headers["content-type"]?.toLowerCase().startsWith("application/json")) {
        response.resume();
        settle();
        reject(new Error("The Hub change response content type is invalid."));
        return;
      }
      readBody(response).then(
        (body) => {
          settle();
          resolve({
            authentication: {
              status: "verified",
              destinationId: input.destinationId,
              peerIdentityHash: input.expectedHubIdentityHash,
            },
            body,
          });
        },
        (error: unknown) => {
          settle();
          reject(error);
        },
      );
    });
    request.end();
  });
}
