import type { IncomingMessage, ServerResponse } from "node:http";

import {
  authorPolicyApproval,
  authorPolicyRevocation,
  authorPolicySnapshot,
  hashPolicyApproverSubject,
  HubPolicyError,
  type HubPolicySigner,
  type HubPolicySourceStore,
} from "@lervo/hub-policy";
import {
  type HubPolicyApprovalWriteRequest,
  type HubPolicyRevocationWriteRequest,
  type HubPolicySnapshotWriteRequest,
  validateSchema,
} from "@lervo/schemas";

import type { HubRequestAuthenticator } from "./auth.js";
import {
  HubHttpRequestTooLargeError,
  matchHubPolicyRoute,
  policyQuery,
  readBoundedJsonBody,
} from "./policy-request.js";
import {
  assertEmptyHubRequestBody,
  InvalidHubHttpRequestError,
  singleAuthorizationHeader,
} from "./request.js";
import {
  resolveHubHttpMaxResponseBytes,
  sendHubError,
  sendHubJson,
} from "./response.js";

const DEFAULT_MAX_REQUEST_BYTES = 262_144;

export interface HubPolicyHttpHandlerOptions {
  authenticator: HubRequestAuthenticator;
  store: HubPolicySourceStore;
  signer: HubPolicySigner;
  hubIdentityHash: string;
  now?: () => Date;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
}

function resolveMaxRequestBytes(value: number | undefined): number {
  const resolved = value ?? DEFAULT_MAX_REQUEST_BYTES;
  if (!Number.isSafeInteger(resolved) || resolved < 1_024 || resolved > 1_048_576) {
    throw new Error("Hub policy maxRequestBytes는 1024 이상 1048576 이하여야 합니다.");
  }
  return resolved;
}

function policyError(
  response: ServerResponse,
  error: HubPolicyError,
  maxResponseBytes: number,
  headers: Record<string, string>,
): void {
  if (error.code === "invalid_policy_request") {
    sendHubError(response, 400, "invalid_request", maxResponseBytes, headers);
  } else if (
    error.code === "policy_registration_required" ||
    error.code === "policy_command_not_found" ||
    error.code === "policy_approval_not_found"
  ) {
    sendHubError(response, 404, "not_found", maxResponseBytes, headers);
  } else if (
    error.code === "policy_identity_mismatch" ||
    error.code === "policy_snapshot_conflict" ||
    error.code === "policy_capacity_exceeded"
  ) {
    sendHubError(response, 409, "conflict", maxResponseBytes, headers);
  } else {
    sendHubError(response, 500, "internal_error", maxResponseBytes, headers);
  }
}

function time(now: () => Date): string {
  const value = now();
  if (!Number.isFinite(value.getTime())) throw new Error("Hub policy clock이 유효하지 않습니다.");
  return value.toISOString();
}

export function createHubPolicyHttpHandler(options: HubPolicyHttpHandlerOptions) {
  if (!/^sha256:[a-f0-9]{64}$/.test(options.hubIdentityHash)) {
    throw new Error("Hub policy identity hash가 유효하지 않습니다.");
  }
  const maxRequestBytes = resolveMaxRequestBytes(options.maxRequestBytes);
  const maxResponseBytes = resolveHubHttpMaxResponseBytes(options.maxResponseBytes);
  const now = options.now ?? (() => new Date());
  const identityHeaders = { "x-lervo-hub-identity": options.hubIdentityHash };

  return async function handleHubPolicyRequest(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const url = new URL(request.url ?? "", "http://lervo.invalid");
      const route = matchHubPolicyRoute(url.pathname);
      if (route === null) {
        sendHubError(response, 404, "not_found", maxResponseBytes, identityHeaders);
        return;
      }
      const expectedMethod = route.kind === "bundle" ? "GET" : "POST";
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
      const query = policyQuery(url.searchParams, route.kind === "bundle");
      const inScope = principal.projects.some((project) =>
        project.destinationId === query.destinationId && project.projectId === route.projectId
      );
      const permission = route.kind === "bundle" ? "policy.read" : "policy.write";
      if (!inScope || !principal.permissions.includes(permission)) {
        sendHubError(response, 403, "forbidden", maxResponseBytes, identityHeaders);
        return;
      }
      const target = {
        projectId: route.projectId,
        projectIdentityHash: query.projectIdentityHash,
      };
      if (route.kind === "bundle") {
        assertEmptyHubRequestBody(request);
        const bundle = await options.store.pullPolicyBundle({
          destinationId: query.destinationId,
          target,
          currentSnapshotId: query.currentSnapshotId,
        });
        sendHubJson(response, 200, {
          schemaVersion: 1,
          destinationId: query.destinationId,
          target,
          bundle,
        }, maxResponseBytes, identityHeaders);
        return;
      }

      const body = await readBoundedJsonBody(request, maxRequestBytes);
      const authoredAt = time(now);
      let result;
      if (route.kind === "snapshots") {
        if (!validateSchema("hubPolicySnapshotWriteRequest", body).valid) {
          throw new InvalidHubHttpRequestError();
        }
        const value = body as HubPolicySnapshotWriteRequest;
        result = await authorPolicySnapshot({
          store: options.store,
          signer: options.signer,
          request: {
            destinationId: query.destinationId,
            target,
            rules: structuredClone(value.rules),
            issuedAt: authoredAt,
            expiresAt: value.expiresAt,
            publishedAt: authoredAt,
          },
        });
      } else if (route.kind === "approvals") {
        if (!validateSchema("hubPolicyApprovalWriteRequest", body).valid) {
          throw new InvalidHubHttpRequestError();
        }
        const value = body as HubPolicyApprovalWriteRequest;
        result = await authorPolicyApproval({
          store: options.store,
          signer: options.signer,
          request: {
            destinationId: query.destinationId,
            target,
            commandId: value.commandId,
            capability: value.capability,
            repositoryPaths: [...value.repositoryPaths],
            approverSubjectHash: hashPolicyApproverSubject({
              principalId: principal.principalId,
              projectIdentityHash: target.projectIdentityHash,
            }),
            grantedAt: authoredAt,
            expiresAt: value.expiresAt,
            publishedAt: authoredAt,
          },
        });
      } else {
        if (!validateSchema("hubPolicyRevocationWriteRequest", body).valid) {
          throw new InvalidHubHttpRequestError();
        }
        const value = body as HubPolicyRevocationWriteRequest;
        result = await authorPolicyRevocation({
          store: options.store,
          signer: options.signer,
          request: {
            destinationId: query.destinationId,
            target,
            approvalId: value.approvalId,
            reasonCode: value.reasonCode,
            revokedAt: authoredAt,
            publishedAt: authoredAt,
          },
        });
      }
      sendHubJson(response, result.status === "published" ? 201 : 200, {
        schemaVersion: 1,
        result,
      }, maxResponseBytes, identityHeaders);
    } catch (error) {
      if (error instanceof HubHttpRequestTooLargeError) {
        sendHubError(response, 413, "request_too_large", maxResponseBytes, identityHeaders);
      } else if (error instanceof InvalidHubHttpRequestError) {
        sendHubError(response, 400, "invalid_request", maxResponseBytes, identityHeaders);
      } else if (error instanceof HubPolicyError) {
        policyError(response, error, maxResponseBytes, identityHeaders);
      } else {
        sendHubError(response, 500, "internal_error", maxResponseBytes, identityHeaders);
      }
    }
  };
}
