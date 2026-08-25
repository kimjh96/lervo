import type { IncomingMessage, ServerResponse } from "node:http";

import {
  handleOutboundEventBatch,
  handleProjectRegistration,
  handleWorkstreamPublish,
  handleWorkstreamRead,
  type HubSyncCommandStore,
  type HubWorkstreamReplicationStore,
  HubWorkstreamReplicationError,
} from "@lervo/hub-sync";
import {
  type OutboundEventBatch,
  type ProjectRegistrationRequest,
  type WorkstreamReplicationPublishRequest,
  validateSchema,
} from "@lervo/schemas";
import { calculateProjectRegistrationId, SyncContractError } from "@lervo/sync-contract";

import type { HubRequestAuthenticator } from "./auth.js";
import { HubHttpRequestTooLargeError, readBoundedJsonBody } from "./body.js";
import { InvalidHubHttpRequestError, singleAuthorizationHeader } from "./request.js";
import { resolveHubHttpMaxResponseBytes, sendHubError, sendHubJson } from "./response.js";
import { hubSyncQuery, matchHubSyncRoute } from "./sync-request.js";

const DEFAULT_MAX_REQUEST_BYTES = 4_194_304;
const MAX_MAX_REQUEST_BYTES = 16_777_216;

export interface HubSyncHttpHandlerOptions {
  authenticator: HubRequestAuthenticator;
  store: HubSyncCommandStore & HubWorkstreamReplicationStore;
  hubIdentityHash: string;
  now?: () => Date;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

function workstreamError(
  response: ServerResponse,
  error: HubWorkstreamReplicationError,
  maximum: number,
  headers: Record<string, string>,
): void {
  if (error.code === "invalid_workstream") {
    sendHubError(response, 400, "invalid_request", maximum, headers);
  } else if (
    [
      "registration_required",
      "unknown_parent",
      "head_limit_exceeded",
      "workstream_conflict",
    ].includes(error.code)
  ) {
    sendHubError(response, 409, "conflict", maximum, headers);
  } else {
    sendHubError(response, 500, "internal_error", maximum, headers);
  }
}

function requestLimit(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_REQUEST_BYTES;
  if (!Number.isSafeInteger(resolved) || resolved < 1_024 || resolved > MAX_MAX_REQUEST_BYTES) {
    throw new Error("Hub sync maxRequestBytes must be between 1024 and 16777216.");
  }
  return resolved;
}

function currentTime(now: () => Date): string {
  const value = now();
  if (!Number.isFinite(value.getTime())) throw new Error("The Hub sync clock is invalid.");
  return value.toISOString();
}

function syncError(
  response: ServerResponse,
  error: SyncContractError,
  maximum: number,
  headers: Record<string, string>,
): void {
  if (
    ["invalid_registration", "invalid_event_batch", "project_sync_disabled"].includes(error.code)
  ) {
    sendHubError(response, 400, "invalid_request", maximum, headers);
  } else if (
    ["registration_identity_conflict", "registration_required", "event_chain_conflict"].includes(
      error.code,
    )
  ) {
    sendHubError(response, 409, "conflict", maximum, headers);
  } else {
    sendHubError(response, 500, "internal_error", maximum, headers);
  }
}

export function createHubSyncHttpHandler(options: HubSyncHttpHandlerOptions) {
  if (!/^sha256:[a-f0-9]{64}$/.test(options.hubIdentityHash)) {
    throw new Error("The Hub sync identity hash is invalid.");
  }
  const maxRequestBytes = requestLimit(options.maxRequestBytes);
  const maxResponseBytes = resolveHubHttpMaxResponseBytes(options.maxResponseBytes);
  const now = options.now ?? (() => new Date());
  const identityHeaders = { "x-lervo-hub-identity": options.hubIdentityHash };

  return async function handleHubSyncRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(request.url ?? "", "http://lervo.invalid");
      const route = matchHubSyncRoute(url.pathname);
      if (route === null) {
        sendHubError(response, 404, "not_found", maxResponseBytes, identityHeaders);
        return;
      }
      const acceptedMethod =
        route.kind === "workstreams"
          ? request.method === "GET" || request.method === "POST"
          : request.method === "POST";
      if (!acceptedMethod) {
        sendHubError(response, 405, "method_not_allowed", maxResponseBytes, {
          ...identityHeaders,
          allow: route.kind === "workstreams" ? "GET, POST" : "POST",
        });
        return;
      }
      const query = hubSyncQuery(url.searchParams);
      const principal = await options.authenticator.authenticate(
        singleAuthorizationHeader(request),
      );
      if (principal === null) {
        sendHubError(response, 401, "unauthorized", maxResponseBytes, {
          ...identityHeaders,
          "www-authenticate": "Bearer",
        });
        return;
      }
      const inScope = principal.projects.some(
        (project) =>
          project.destinationId === query.destinationId && project.projectId === route.projectId,
      );
      const requiredPermission =
        route.kind === "workstreams"
          ? request.method === "GET"
            ? "workstream.read"
            : "workstream.write"
          : "sync.write";
      if (!inScope || !principal.permissions.includes(requiredPermission)) {
        sendHubError(response, 403, "forbidden", maxResponseBytes, identityHeaders);
        return;
      }

      const expectedRegistrationId = calculateProjectRegistrationId({
        destinationId: query.destinationId,
        identityHash: query.projectIdentityHash,
      });
      const acceptedAt = currentTime(now);
      if (route.kind === "workstreams" && request.method === "GET") {
        const result = await handleWorkstreamRead({
          store: options.store,
          destinationId: query.destinationId,
          projectId: route.projectId,
          repositoryIdentityHash: query.projectIdentityHash,
        });
        sendHubJson(response, 200, result, maxResponseBytes, identityHeaders);
        return;
      }
      const body = await readBoundedJsonBody(request, maxRequestBytes);
      if (route.kind === "registration") {
        if (!validateSchema("projectRegistrationRequest", body).valid) {
          throw new InvalidHubHttpRequestError();
        }
        const registration = body as ProjectRegistrationRequest;
        if (
          registration.destinationId !== query.destinationId ||
          registration.project.projectId !== route.projectId ||
          registration.projectIdentityHash !== query.projectIdentityHash ||
          registration.registrationId !== expectedRegistrationId
        )
          throw new InvalidHubHttpRequestError();
        const result = await handleProjectRegistration({
          store: options.store,
          request: registration,
          acceptedAt,
        });
        sendHubJson(
          response,
          result.status === "registered" ? 201 : 200,
          result,
          maxResponseBytes,
          identityHeaders,
        );
        return;
      }

      if (route.kind === "workstreams") {
        if (!validateSchema("workstreamReplicationPublishRequest", body).valid) {
          throw new InvalidHubHttpRequestError();
        }
        const publication = body as WorkstreamReplicationPublishRequest;
        if (
          publication.projectId !== route.projectId ||
          publication.repositoryIdentityHash !== query.projectIdentityHash ||
          publication.registrationId !== expectedRegistrationId
        )
          throw new InvalidHubHttpRequestError();
        const result = await handleWorkstreamPublish({
          store: options.store,
          destinationId: query.destinationId,
          request: publication,
          publishedAt: acceptedAt,
        });
        sendHubJson(
          response,
          result.status === "created" ? 201 : 200,
          result,
          maxResponseBytes,
          identityHeaders,
        );
        return;
      }

      if (!validateSchema("outboundEventBatch", body).valid) {
        throw new InvalidHubHttpRequestError();
      }
      const batch = body as OutboundEventBatch;
      if (
        batch.destinationId !== query.destinationId ||
        batch.projectId !== route.projectId ||
        batch.registrationId !== expectedRegistrationId
      )
        throw new InvalidHubHttpRequestError();
      const acknowledgement = await handleOutboundEventBatch({
        store: options.store,
        batch,
        acknowledgedAt: acceptedAt,
      });
      sendHubJson(response, 200, acknowledgement, maxResponseBytes, identityHeaders);
    } catch (error) {
      if (error instanceof HubHttpRequestTooLargeError) {
        sendHubError(response, 413, "request_too_large", maxResponseBytes, identityHeaders);
      } else if (error instanceof InvalidHubHttpRequestError) {
        sendHubError(response, 400, "invalid_request", maxResponseBytes, identityHeaders);
      } else if (error instanceof SyncContractError) {
        syncError(response, error, maxResponseBytes, identityHeaders);
      } else if (error instanceof HubWorkstreamReplicationError) {
        workstreamError(response, error, maxResponseBytes, identityHeaders);
      } else {
        sendHubError(response, 500, "internal_error", maxResponseBytes, identityHeaders);
      }
    }
  };
}
