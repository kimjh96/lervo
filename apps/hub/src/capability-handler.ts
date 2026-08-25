import type { IncomingMessage, ServerResponse } from "node:http";

import {
  CapabilityPackageError,
  capabilityPublicationStructure,
  decodeCapabilityPackage,
  type CapabilityPackageEnvelope,
  type CapabilityPublicationScope,
  type CapabilityRegistry,
} from "@lervo/capabilities";

import type { HubRequestAuthenticator, HubAuthenticatedPrincipal } from "./auth.js";
import { HubHttpRequestTooLargeError, readBoundedJsonBody } from "./body.js";
import { InvalidHubHttpRequestError, singleAuthorizationHeader } from "./request.js";
import { resolveHubHttpMaxResponseBytes, sendHubError, sendHubJson } from "./response.js";

const MAX_REQUEST_BYTES = 16_777_216;

export interface HubCapabilityHttpHandlerOptions {
  authenticator: HubRequestAuthenticator;
  registry: CapabilityRegistry;
  hubIdentityHash: string;
  now?: () => Date;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

function scope(value: unknown): CapabilityPublicationScope {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new InvalidHubHttpRequestError();
  const item = value as Record<string, unknown>;
  if (item.kind === "public" && Object.keys(item).length === 1) return { kind: "public" };
  if (
    item.kind === "project" &&
    Object.keys(item).length === 3 &&
    typeof item.destinationId === "string" &&
    typeof item.projectId === "string"
  )
    return { kind: "project", destinationId: item.destinationId, projectId: item.projectId };
  throw new InvalidHubHttpRequestError();
}

function authorized(
  principal: HubAuthenticatedPrincipal,
  target: CapabilityPublicationScope,
  permission: "capability.read" | "capability.publish",
): boolean {
  return (
    principal.permissions.includes(permission) &&
    (target.kind === "public" ||
      principal.projects.some(
        (project) =>
          project.destinationId === target.destinationId && project.projectId === target.projectId,
      ))
  );
}

function queryScope(search: URLSearchParams): CapabilityPublicationScope {
  const kind = search.get("scope");
  if (kind === "public") return { kind: "public" };
  if (kind === "project")
    return scope({
      kind,
      destinationId: search.get("destinationId"),
      projectId: search.get("projectId"),
    });
  throw new InvalidHubHttpRequestError();
}

export function createHubCapabilityHttpHandler(options: HubCapabilityHttpHandlerOptions) {
  const maximumRequest = options.maxRequestBytes ?? MAX_REQUEST_BYTES;
  const maximumResponse = resolveHubHttpMaxResponseBytes(
    options.maxResponseBytes ?? MAX_REQUEST_BYTES,
  );
  const identityHeaders = { "x-lervo-hub-identity": options.hubIdentityHash };
  const now = options.now ?? (() => new Date());
  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      const url = new URL(request.url ?? "", "http://lervo.invalid");
      if (
        url.pathname !== "/v1/capabilities/package" ||
        !["GET", "POST"].includes(request.method ?? "")
      ) {
        sendHubError(
          response,
          url.pathname === "/v1/capabilities/package" ? 405 : 404,
          url.pathname === "/v1/capabilities/package" ? "method_not_allowed" : "not_found",
          maximumResponse,
          identityHeaders,
        );
        return;
      }
      const principal = await options.authenticator.authenticate(
        singleAuthorizationHeader(request),
      );
      if (principal === null) {
        sendHubError(response, 401, "unauthorized", maximumResponse, {
          ...identityHeaders,
          "www-authenticate": "Bearer",
        });
        return;
      }
      if (request.method === "GET") {
        const target = queryScope(url.searchParams);
        if (!authorized(principal, target, "capability.read")) {
          sendHubError(response, 403, "forbidden", maximumResponse, identityHeaders);
          return;
        }
        const id = url.searchParams.get("capabilityId") ?? "";
        const version = url.searchParams.get("version") ?? "";
        const value = await options.registry.get(target, id, version);
        if (value === null) {
          sendHubError(response, 404, "not_found", maximumResponse, identityHeaders);
          return;
        }
        sendHubJson(response, 200, value, maximumResponse, identityHeaders);
        return;
      }
      const body = (await readBoundedJsonBody(request, maximumRequest)) as {
        schemaVersion?: unknown;
        scope?: unknown;
        package?: unknown;
      };
      if (body === null || typeof body !== "object" || body.schemaVersion !== 1)
        throw new InvalidHubHttpRequestError();
      const target = scope(body.scope);
      if (!authorized(principal, target, "capability.publish")) {
        sendHubError(response, 403, "forbidden", maximumResponse, identityHeaders);
        return;
      }
      const verified = decodeCapabilityPackage(body.package);
      const publishedAt = now().toISOString();
      if (Number.isNaN(Date.parse(publishedAt))) throw new Error("Invalid clock");
      const packageValue = body.package as CapabilityPackageEnvelope;
      const published = {
        schemaVersion: 1 as const,
        scope: target,
        publisherPrincipalId: principal.principalId,
        publishedAt,
        structure: capabilityPublicationStructure(packageValue),
        package: packageValue,
      };
      const status = await options.registry.put(published);
      sendHubJson(
        response,
        status === "created" ? 201 : 200,
        {
          schemaVersion: 1,
          status,
          capabilityId: verified.manifest.capabilityId,
          version: verified.manifest.version,
          contentHash: verified.manifest.contentHash,
          scope: target,
          publishedAt,
        },
        maximumResponse,
        identityHeaders,
      );
    } catch (error) {
      if (error instanceof HubHttpRequestTooLargeError)
        sendHubError(response, 413, "request_too_large", maximumResponse, identityHeaders);
      else if (
        error instanceof InvalidHubHttpRequestError ||
        (error instanceof CapabilityPackageError &&
          [
            "capability_invalid",
            "capability_content_hash_mismatch",
            "capability_unsafe_package",
          ].includes(error.code))
      )
        sendHubError(response, 400, "invalid_request", maximumResponse, identityHeaders);
      else if (error instanceof CapabilityPackageError && error.code === "capability_conflict")
        sendHubError(response, 409, "conflict", maximumResponse, identityHeaders);
      else sendHubError(response, 500, "internal_error", maximumResponse, identityHeaders);
    }
  };
}
