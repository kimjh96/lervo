import type { IncomingMessage, ServerResponse } from "node:http";

import { HubCommandError } from "@lervo/hub-command";
import {
  classifyHubRemoteCommandFailure,
  handleRemoteCommandAcknowledgement,
  handleRemoteCommandLease,
  type HubRemoteCommandQueueStore,
} from "@lervo/hub-sync";
import {
  type RemoteCommandDeliveryAcknowledgement,
  validateSchema,
} from "@lervo/schemas";

import type { HubRequestAuthenticator } from "./auth.js";
import { HubHttpRequestTooLargeError, readBoundedJsonBody } from "./body.js";
import {
  handleHubCommandArtifactDownload,
  handleHubCommandSubmission,
  type HubCommandAuthoringHttpOptions,
} from "./command-authoring-handler.js";
import {
  matchHubRemoteCommandRoute,
  remoteCommandAuthoringQuery,
  remoteCommandLeaseBody,
  remoteCommandQuery,
} from "./command-request.js";
import { InvalidHubHttpRequestError, singleAuthorizationHeader } from "./request.js";
import { resolveHubHttpMaxResponseBytes, sendHubError, sendHubJson } from "./response.js";

const DEFAULT_MAX_REQUEST_BYTES = 262_144;

export interface HubRemoteCommandHttpHandlerOptions {
  authenticator: HubRequestAuthenticator;
  store: HubRemoteCommandQueueStore;
  hubIdentityHash: string;
  now?: () => Date;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  authoring?: HubCommandAuthoringHttpOptions;
}

function requestLimit(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_REQUEST_BYTES;
  if (!Number.isSafeInteger(resolved) || resolved < 1_024 || resolved > 1_048_576) {
    throw new Error("Hub remote command maxRequestBytes는 1024 이상 1048576 이하여야 합니다.");
  }
  return resolved;
}

function currentTime(now: () => Date): string {
  const value = now();
  if (!Number.isFinite(value.getTime())) throw new Error("Hub remote command clock이 유효하지 않습니다.");
  return value.toISOString();
}

export function createHubRemoteCommandHttpHandler(options: HubRemoteCommandHttpHandlerOptions) {
  if (!/^sha256:[a-f0-9]{64}$/.test(options.hubIdentityHash)) {
    throw new Error("Hub remote command identity hash가 유효하지 않습니다.");
  }
  const maxRequestBytes = requestLimit(options.maxRequestBytes);
  const maxResponseBytes = resolveHubHttpMaxResponseBytes(options.maxResponseBytes);
  const now = options.now ?? (() => new Date());
  const identityHeaders = { "x-lervo-hub-identity": options.hubIdentityHash };

  return async function handleHubRemoteCommandRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(request.url ?? "", "http://lervo.invalid");
      const route = matchHubRemoteCommandRoute(url.pathname);
      if (route === null) {
        sendHubError(response, 404, "not_found", maxResponseBytes, identityHeaders);
        return;
      }
      const expectedMethod = route.kind === "artifacts" ? "GET" : "POST";
      if (request.method !== expectedMethod) {
        sendHubError(response, 405, "method_not_allowed", maxResponseBytes, {
          ...identityHeaders,
          allow: expectedMethod,
        });
        return;
      }
      const principal = await options.authenticator.authenticate(singleAuthorizationHeader(request));
      if (principal === null) {
        sendHubError(response, 401, "unauthorized", maxResponseBytes, {
          ...identityHeaders,
          "www-authenticate": "Bearer",
        });
        return;
      }
      if (route.kind === "submissions") {
        const query = remoteCommandAuthoringQuery(url.searchParams);
        const inScope = principal.projects.some((project) =>
          project.destinationId === query.destinationId && project.projectId === route.projectId
        );
        if (!inScope || !principal.permissions.includes("command.write")) {
          sendHubError(response, 403, "forbidden", maxResponseBytes, identityHeaders);
          return;
        }
        if (options.authoring === undefined) {
          sendHubError(response, 404, "not_found", maxResponseBytes, identityHeaders);
          return;
        }
        await handleHubCommandSubmission({
          request,
          response,
          authoring: options.authoring,
          destinationId: query.destinationId,
          target: {
            projectId: route.projectId,
            projectIdentityHash: query.projectIdentityHash,
          },
          principalId: principal.principalId,
          authoredAt: currentTime(now),
          maxRequestBytes,
          maxResponseBytes,
          identityHeaders,
        });
        return;
      }

      const query = remoteCommandQuery(url.searchParams);
      const inScope = principal.projects.some((project) =>
        project.destinationId === query.destinationId && project.projectId === route.projectId
      );
      if (
        !inScope || !principal.permissions.includes("command.delivery") ||
        principal.principalId !== query.nodeId
      ) {
        sendHubError(response, 403, "forbidden", maxResponseBytes, identityHeaders);
        return;
      }
      const target = {
        projectId: route.projectId,
        projectIdentityHash: query.projectIdentityHash,
      };
      if (route.kind === "artifacts") {
        if (options.authoring === undefined) {
          sendHubError(response, 404, "not_found", maxResponseBytes, identityHeaders);
          return;
        }
        await handleHubCommandArtifactDownload({
          response,
          authoring: options.authoring,
          destinationId: query.destinationId,
          target,
          nodeId: query.nodeId,
          artifactId: route.artifactId!,
          requestedAt: currentTime(now),
          maxResponseBytes,
          identityHeaders,
        });
        return;
      }
      const body = await readBoundedJsonBody(request, maxRequestBytes);
      const at = currentTime(now);
      if (route.kind === "leases") {
        const leaseRequest = remoteCommandLeaseBody(body);
        const leases = await handleRemoteCommandLease({
          store: options.store,
          destinationId: query.destinationId,
          target,
          leasedTo: query.nodeId,
          leasedAt: at,
          leaseDurationMs: leaseRequest.leaseDurationMs,
          limit: leaseRequest.limit,
        });
        sendHubJson(response, 200, {
          schemaVersion: 1,
          destinationId: query.destinationId,
          target,
          nodeId: query.nodeId,
          leases,
        }, maxResponseBytes, identityHeaders);
        return;
      }
      if (!validateSchema("remoteCommandDeliveryAcknowledgement", body).valid) {
        throw new InvalidHubHttpRequestError();
      }
      const confirmation = await handleRemoteCommandAcknowledgement({
        store: options.store,
        destinationId: query.destinationId,
        target,
        leasedTo: query.nodeId,
        acknowledgement: structuredClone(body as RemoteCommandDeliveryAcknowledgement),
        confirmedAt: at,
      });
      sendHubJson(response, 200, {
        schemaVersion: 1,
        destinationId: query.destinationId,
        target,
        nodeId: query.nodeId,
        confirmation,
      }, maxResponseBytes, identityHeaders);
    } catch (error) {
      if (error instanceof HubHttpRequestTooLargeError) {
        sendHubError(response, 413, "request_too_large", maxResponseBytes, identityHeaders);
        return;
      }
      if (error instanceof InvalidHubHttpRequestError) {
        sendHubError(response, 400, "invalid_request", maxResponseBytes, identityHeaders);
        return;
      }
      if (error instanceof HubCommandError) {
        if (error.code === "invalid_request") {
          sendHubError(response, 400, "invalid_request", maxResponseBytes, identityHeaders);
        } else if (
          error.code === "idempotency_conflict" ||
          error.code === "artifact_cleanup_conflict"
        ) {
          sendHubError(response, 409, "conflict", maxResponseBytes, identityHeaders);
        } else {
          sendHubError(response, 500, "internal_error", maxResponseBytes, identityHeaders);
        }
        return;
      }
      const failure = classifyHubRemoteCommandFailure(error);
      if (failure === "not_found") {
        sendHubError(response, 404, "not_found", maxResponseBytes, identityHeaders);
      } else if (failure === "conflict") {
        sendHubError(response, 409, "conflict", maxResponseBytes, identityHeaders);
      } else if (failure === "invalid_request") {
        sendHubError(response, 400, "invalid_request", maxResponseBytes, identityHeaders);
      } else {
        sendHubError(response, 500, "internal_error", maxResponseBytes, identityHeaders);
      }
    }
  };
}
