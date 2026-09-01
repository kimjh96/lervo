import { type IncomingMessage, type ServerResponse } from "node:http";

import { createEventReaderCapabilities } from "@lervo/event-contract";

import { sendHubError, sendHubJson } from "./response.js";

const HEALTH_RESPONSE_BYTES = 4_096;

export interface HubHealthHttpHandlerOptions {
  hubIdentityHash: string;
  checkReady(): Promise<unknown>;
}

function identityHeaders(hubIdentityHash: string): Record<string, string> {
  return { "x-lervo-hub-identity": hubIdentityHash };
}

export function createHubHealthHttpHandler(options: HubHealthHttpHandlerOptions) {
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const headers = identityHeaders(options.hubIdentityHash);
    let url: URL;
    try {
      url = new URL(request.url ?? "", "http://lervo.local");
    } catch {
      sendHubError(response, 400, "invalid_request", HEALTH_RESPONSE_BYTES, headers);
      return;
    }
    if (request.method !== "GET") {
      sendHubError(response, 405, "method_not_allowed", HEALTH_RESPONSE_BYTES, {
        ...headers,
        allow: "GET",
      });
      return;
    }
    if (url.search !== "") {
      sendHubError(response, 400, "invalid_request", HEALTH_RESPONSE_BYTES, headers);
      return;
    }
    if (url.pathname === "/v1/health/live") {
      sendHubJson(
        response,
        200,
        { schemaVersion: 1, status: "live" },
        HEALTH_RESPONSE_BYTES,
        headers,
      );
      return;
    }
    if (url.pathname === "/v1/health/capabilities") {
      sendHubJson(response, 200, createEventReaderCapabilities(), HEALTH_RESPONSE_BYTES, headers);
      return;
    }
    if (url.pathname !== "/v1/health/ready") {
      sendHubError(response, 404, "not_found", HEALTH_RESPONSE_BYTES, headers);
      return;
    }
    try {
      await options.checkReady();
      sendHubJson(
        response,
        200,
        { schemaVersion: 1, status: "ready" },
        HEALTH_RESPONSE_BYTES,
        headers,
      );
    } catch {
      sendHubJson(
        response,
        503,
        {
          schemaVersion: 1,
          status: "not_ready",
          failureCode: "storage_unavailable",
        },
        HEALTH_RESPONSE_BYTES,
        headers,
      );
    }
  };
}
