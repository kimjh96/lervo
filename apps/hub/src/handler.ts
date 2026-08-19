import { type IncomingMessage, type ServerResponse } from "node:http";

import {
  HubProjectScopedTraceReader,
  HubTraceError,
  type HubTraceSource,
} from "@lervo/hub-trace";

import { type HubRequestAuthenticator } from "./auth.js";
import {
  encodeEventCursor,
  encodeProjectCursor,
  encodeRunCursor,
} from "./cursor.js";
import {
  assertEmptyHubRequestBody,
  InvalidHubHttpRequestError,
  matchHubTraceRoute,
  projectListQuery,
  projectRunQuery,
  runEventQuery,
  singleAuthorizationHeader,
} from "./request.js";
import {
  resolveHubHttpMaxResponseBytes,
  sendHubError,
  sendHubJson,
} from "./response.js";

export interface HubTraceHttpHandlerOptions {
  authenticator: HubRequestAuthenticator;
  source: HubTraceSource;
  maxResponseBytes?: number;
}

function traceErrorResponse(
  response: ServerResponse,
  error: HubTraceError,
  maxResponseBytes: number,
): void {
  switch (error.code) {
    case "invalid_query":
      sendHubError(response, 400, "invalid_request", maxResponseBytes);
      return;
    case "project_forbidden":
      sendHubError(response, 403, "forbidden", maxResponseBytes);
      return;
    case "project_not_found":
      sendHubError(response, 404, "project_not_found", maxResponseBytes);
      return;
    case "run_not_found":
      sendHubError(response, 404, "run_not_found", maxResponseBytes);
      return;
    case "source_inconsistent":
      sendHubError(response, 500, "internal_error", maxResponseBytes);
  }
}

export function createHubTraceHttpHandler(options: HubTraceHttpHandlerOptions) {
  const maxResponseBytes = resolveHubHttpMaxResponseBytes(options.maxResponseBytes);

  return async function handleHubTraceRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      if (request.method !== "GET") {
        sendHubError(response, 405, "method_not_allowed", maxResponseBytes, { allow: "GET" });
        return;
      }
      assertEmptyHubRequestBody(request);
      const url = new URL(request.url ?? "", "http://lervo.invalid");
      const matchedRoute = matchHubTraceRoute(url.pathname);
      if (matchedRoute === null) {
        sendHubError(response, 404, "not_found", maxResponseBytes);
        return;
      }
      const principal = await options.authenticator.authenticate(singleAuthorizationHeader(request));
      if (principal === null) {
        sendHubError(response, 401, "unauthorized", maxResponseBytes, {
          "www-authenticate": "Bearer",
        });
        return;
      }
      if (!principal.permissions.includes("trace.read")) {
        sendHubError(response, 403, "forbidden", maxResponseBytes);
        return;
      }

      let reader: HubProjectScopedTraceReader;
      try {
        reader = new HubProjectScopedTraceReader(options.source, principal.projects);
      } catch (error) {
        throw new Error("Hub authenticator가 유효하지 않은 project scope를 반환했습니다.", {
          cause: error,
        });
      }
      if (matchedRoute.kind === "projects") {
        const result = await reader.listProjects(projectListQuery(url.searchParams));
        sendHubJson(response, 200, {
          schemaVersion: 1,
          projects: result.items,
          nextCursor: result.nextCursor === null ? null : encodeProjectCursor(result.nextCursor),
        }, maxResponseBytes);
        return;
      }

      if (matchedRoute.kind === "project") {
        const result = await reader.getProject(projectRunQuery(matchedRoute, url.searchParams));
        sendHubJson(response, 200, {
          schemaVersion: 1,
          project: result.project,
          runs: result.runs.items,
          nextCursor: result.runs.nextCursor === null ? null : encodeRunCursor(result.runs.nextCursor),
        }, maxResponseBytes);
        return;
      }

      const result = await reader.getRun(runEventQuery(matchedRoute, url.searchParams));
      sendHubJson(response, 200, {
        schemaVersion: 1,
        project: result.project,
        run: result.run,
        events: result.events.items,
        nextCursor: result.events.nextCursor === null ? null : encodeEventCursor(result.events.nextCursor),
      }, maxResponseBytes);
    } catch (error) {
      if (error instanceof InvalidHubHttpRequestError) {
        sendHubError(response, 400, "invalid_request", maxResponseBytes);
      } else if (error instanceof HubTraceError) {
        traceErrorResponse(response, error, maxResponseBytes);
      } else {
        sendHubError(response, 500, "internal_error", maxResponseBytes);
      }
    }
  };
}
