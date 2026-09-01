import type {
  OutboundEventBatch,
  ProjectRegistrationRequest,
  RemoteCommandTarget,
  WorkstreamReplicationPublishRequest,
} from "@lervo/schemas";
import {
  isHubWorkspaceCoordinationMutation,
  isHubWorkspaceSummary,
  type HubWorkspaceCoordinationMutation,
  type HubWorkspaceSummary,
} from "@lervo/hub-sync";
import { validateSchema } from "@lervo/schemas";
import {
  assertOutboundEventBatch,
  assertProjectRegistrationRequest,
  calculateProjectRegistrationId,
} from "@lervo/sync-contract";

import { readSyncHttpJson } from "./http-json.js";
import type {
  AuthenticatedHubCapabilityTransport,
  AuthenticatedHubTransport,
  AuthenticatedWorkstreamHubTransport,
} from "./transport.js";

const DEFAULT_MAX_REQUEST_BYTES = 4_194_304;
const MAXIMUM_HTTP_BYTES = 16_777_216;
const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const PROJECT_PATTERN = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface SyncHttpTransportOptions {
  baseUrl: string;
  bearerToken: string;
  expectedHubIdentityHash: string;
  destinationId: string;
  target: RemoteCommandTarget;
  maxRequestBytes?: number;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
  allowInsecureHttpForTests?: boolean;
  fetch?: typeof globalThis.fetch;
}

function configuredUrl(value: string, allowInsecure: boolean): URL {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:")) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new Error(
      "The Hub synchronization URL must be an HTTPS URL without credentials or a query.",
    );
  return url;
}

function byteLimit(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1_024 || resolved > MAXIMUM_HTTP_BYTES) {
    throw new Error(`${label} must be between 1024 and 16777216.`);
  }
  return resolved;
}

export class AuthenticatedHubHttpTransport
  implements
    AuthenticatedHubTransport,
    AuthenticatedHubCapabilityTransport,
    AuthenticatedWorkstreamHubTransport
{
  private readonly baseUrl: URL;
  private readonly bearerToken: string;
  private readonly expectedHubIdentityHash: string;
  private readonly destinationId: string;
  private readonly target: RemoteCommandTarget;
  private readonly maxRequestBytes: number;
  private readonly maxResponseBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly request: typeof globalThis.fetch;
  private readonly registrationId: string;

  constructor(options: SyncHttpTransportOptions) {
    this.baseUrl = configuredUrl(options.baseUrl, options.allowInsecureHttpForTests === true);
    if (
      options.bearerToken.length < 32 ||
      options.bearerToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/.test(options.bearerToken) ||
      !HASH_PATTERN.test(options.expectedHubIdentityHash) ||
      !DESTINATION_PATTERN.test(options.destinationId) ||
      !PROJECT_PATTERN.test(options.target.projectId) ||
      !HASH_PATTERN.test(options.target.projectIdentityHash)
    )
      throw new Error("The Hub synchronization HTTP transport configuration is invalid.");
    this.bearerToken = options.bearerToken;
    this.expectedHubIdentityHash = options.expectedHubIdentityHash;
    this.destinationId = options.destinationId;
    this.target = { ...options.target };
    this.maxRequestBytes = byteLimit(
      options.maxRequestBytes,
      DEFAULT_MAX_REQUEST_BYTES,
      "Hub synchronization HTTP request limit",
    );
    this.maxResponseBytes = byteLimit(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "Hub synchronization HTTP response limit",
    );
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 10 ||
      this.requestTimeoutMs > 300_000
    ) {
      throw new Error("The Hub synchronization HTTP request timeout is invalid.");
    }
    this.request = options.fetch ?? globalThis.fetch;
    this.registrationId = calculateProjectRegistrationId({
      destinationId: options.destinationId,
      identityHash: options.target.projectIdentityHash,
    });
  }

  async registerProject(request: ProjectRegistrationRequest): Promise<unknown> {
    assertProjectRegistrationRequest(request);
    if (
      request.destinationId !== this.destinationId ||
      request.projectIdentityHash !== this.target.projectIdentityHash ||
      request.registrationId !== this.registrationId ||
      request.project.projectId !== this.target.projectId
    )
      throw new Error(
        "The Hub synchronization registration coordinates differ from the transport configuration.",
      );
    return this.post("registration", request, [200, 201]);
  }

  async sendEventBatch(batch: OutboundEventBatch): Promise<unknown> {
    assertOutboundEventBatch(batch);
    if (
      batch.destinationId !== this.destinationId ||
      batch.projectId !== this.target.projectId ||
      batch.registrationId !== this.registrationId
    )
      throw new Error(
        "The Hub synchronization event batch coordinates differ from the transport configuration.",
      );
    return this.post("event-batches", batch, [200]);
  }

  async publishWorkstream(request: WorkstreamReplicationPublishRequest): Promise<unknown> {
    if (!validateSchema("workstreamReplicationPublishRequest", request).valid) {
      throw new Error("The workstream publication request is invalid.");
    }
    if (
      request.projectId !== this.target.projectId ||
      request.repositoryIdentityHash !== this.target.projectIdentityHash ||
      request.registrationId !== this.registrationId
    )
      throw new Error(
        "The workstream publication coordinates differ from the transport configuration.",
      );
    return this.requestJson("workstreams", "POST", request, [200, 201]);
  }

  async readWorkstream(): Promise<unknown> {
    return this.requestJson("workstreams", "GET", undefined, [200]);
  }

  async readEventReaderCapabilities(): Promise<unknown> {
    const url = new URL(
      "v1/health/capabilities",
      this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`),
    );
    return this.performJsonRequest(url, "GET", undefined, [200], false);
  }

  async coordinateWorkspace(mutation: HubWorkspaceCoordinationMutation): Promise<unknown> {
    if (!isHubWorkspaceCoordinationMutation(mutation))
      throw new Error("The workspace coordination mutation is invalid.");
    if (
      mutation.request.projectId !== this.target.projectId ||
      mutation.request.repositoryIdentityHash !== this.target.projectIdentityHash
    )
      throw new Error(
        "The workspace coordination coordinates differ from the transport configuration.",
      );
    return this.requestJson("workspace-reservations", "POST", mutation, [200, 201]);
  }

  async publishWorkspaceSummary(summary: HubWorkspaceSummary): Promise<unknown> {
    if (
      !isHubWorkspaceSummary(summary) ||
      summary.projectId !== this.target.projectId ||
      summary.repositoryIdentityHash !== this.target.projectIdentityHash
    )
      throw new Error("The workspace summary coordinates are invalid.");
    return this.requestJson("workspace-summaries", "POST", summary, [200, 201]);
  }

  async readWorkspaceSummaries(): Promise<unknown> {
    return this.requestJson("workspace-summaries", "GET", undefined, [200]);
  }

  private async post(
    kind: "registration" | "event-batches",
    body: unknown,
    acceptedStatuses: readonly number[],
  ): Promise<unknown> {
    return this.requestJson(kind, "POST", body, acceptedStatuses);
  }

  private async requestJson(
    kind:
      | "registration"
      | "event-batches"
      | "workstreams"
      | "workspace-reservations"
      | "workspace-summaries",
    method: "GET" | "POST",
    body: unknown | undefined,
    acceptedStatuses: readonly number[],
  ): Promise<unknown> {
    const serialized = body === undefined ? undefined : JSON.stringify(body);
    if (serialized !== undefined && Buffer.byteLength(serialized, "utf8") > this.maxRequestBytes) {
      throw new Error("The Hub synchronization request exceeds the allowed size.");
    }
    const url = new URL(
      `v1/sync/projects/${encodeURIComponent(this.target.projectId)}/${kind}`,
      this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`),
    );
    url.searchParams.set("destinationId", this.destinationId);
    url.searchParams.set("projectIdentityHash", this.target.projectIdentityHash);
    return this.performJsonRequest(url, method, serialized, acceptedStatuses, true);
  }

  private async performJsonRequest(
    url: URL,
    method: "GET" | "POST",
    serialized: string | undefined,
    acceptedStatuses: readonly number[],
    authenticated: boolean,
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.request(url, {
        method,
        headers: {
          accept: "application/json",
          ...(authenticated ? { authorization: `Bearer ${this.bearerToken}` } : {}),
          ...(serialized === undefined
            ? {}
            : { "content-type": "application/json; charset=utf-8" }),
        },
        ...(serialized === undefined ? {} : { body: serialized }),
        redirect: "error",
        signal: controller.signal,
      });
      if (!acceptedStatuses.includes(response.status)) {
        await response.body?.cancel();
        throw new Error("The Hub synchronization response status is invalid.");
      }
      if (response.headers.get("x-lervo-hub-identity") !== this.expectedHubIdentityHash) {
        await response.body?.cancel();
        return {
          authentication: {
            status: "unverified",
            destinationId: this.destinationId,
            peerIdentityHash: null,
          },
          body: null,
        };
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        await response.body?.cancel();
        throw new Error("The Hub synchronization response content type is invalid.");
      }
      return {
        authentication: {
          status: "verified",
          destinationId: this.destinationId,
          peerIdentityHash: this.expectedHubIdentityHash,
        },
        body: await readSyncHttpJson(response, this.maxResponseBytes),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
