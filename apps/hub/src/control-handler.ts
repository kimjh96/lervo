import type { IncomingMessage, ServerResponse } from "node:http";

import {
  HubCommandControlReader,
  HubControlError,
  type HubControlReviewGrants,
  type HubCommandControlSource,
} from "@lervo/hub-control";

import type { HubRequestAuthenticator } from "./auth.js";
import { controlDestination, matchHubControlRoute } from "./control-request.js";
import {
  assertEmptyHubRequestBody,
  InvalidHubHttpRequestError,
  singleAuthorizationHeader,
} from "./request.js";
import { resolveHubHttpMaxResponseBytes, sendHubError, sendHubJson } from "./response.js";

export interface HubControlHttpHandlerOptions {
  authenticator: HubRequestAuthenticator;
  source: HubCommandControlSource;
  reviewGrants: HubControlReviewGrants;
  now?: () => Date;
  maxResponseBytes?: number;
}

function inspectedAt(now: () => Date): string {
  const value = now();
  if (!Number.isFinite(value.getTime())) throw new Error("The Hub control clock is invalid.");
  return value.toISOString();
}

function singleReviewGrant(request: IncomingMessage): string | null {
  const value = request.headers["x-lervo-control-review"];
  return typeof value === "string" && value.length <= 128 ? value : null;
}

export function createHubControlHttpHandler(options: HubControlHttpHandlerOptions) {
  const reader = new HubCommandControlReader(options.source);
  const now = options.now ?? (() => new Date());
  const maximum = resolveHubHttpMaxResponseBytes(options.maxResponseBytes);
  return async function handleHubControlRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      if (request.method !== "GET") {
        sendHubError(response, 405, "method_not_allowed", maximum, { allow: "GET" });
        return;
      }
      assertEmptyHubRequestBody(request);
      const url = new URL(request.url ?? "", "http://lervo.invalid");
      const route = matchHubControlRoute(url.pathname);
      if (route === null) {
        sendHubError(response, 404, "not_found", maximum);
        return;
      }
      const destinationId = controlDestination(url.searchParams);
      const principal = await options.authenticator.authenticate(singleAuthorizationHeader(request));
      if (principal === null) {
        sendHubError(response, 401, "unauthorized", maximum, {
          "www-authenticate": "Bearer",
        });
        return;
      }
      const inScope = principal.projects.some((project) =>
        project.destinationId === destinationId && project.projectId === route.projectId
      );
      if (!inScope || !principal.permissions.includes("command.read")) {
        sendHubError(response, 403, "forbidden", maximum);
        return;
      }
      const at = inspectedAt(now);
      const reviewGrant = singleReviewGrant(request);
      if (reviewGrant === null || !options.reviewGrants.verify({
        grant: reviewGrant,
        principalId: principal.principalId,
        destinationId,
        projectId: route.projectId,
        deliveryId: route.deliveryId,
        verifiedAt: at,
      })) {
        sendHubError(response, 403, "forbidden", maximum);
        return;
      }
      const review = await reader.inspect({
        destinationId,
        projectId: route.projectId,
        deliveryId: route.deliveryId,
        inspectedAt: at,
      });
      sendHubJson(response, 200, review, maximum);
    } catch (error) {
      if (error instanceof InvalidHubHttpRequestError ||
        (error instanceof HubControlError && error.code === "invalid_control_request")) {
        sendHubError(response, 400, "invalid_request", maximum);
      } else if (error instanceof HubControlError && error.code === "command_not_found") {
        sendHubError(response, 404, "not_found", maximum);
      } else {
        sendHubError(response, 500, "internal_error", maximum);
      }
    }
  };
}
