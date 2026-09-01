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

import { HubJsonHttpClient } from "./hub-json-http-client.js";
import type {
  AuthenticatedHubCapabilityTransport,
  AuthenticatedHubTransport,
  AuthenticatedWorkstreamHubTransport,
} from "./transport.js";

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

export class AuthenticatedHubHttpTransport
  implements
    AuthenticatedHubTransport,
    AuthenticatedHubCapabilityTransport,
    AuthenticatedWorkstreamHubTransport
{
  private readonly baseUrl: URL;
  private readonly destinationId: string;
  private readonly target: RemoteCommandTarget;
  private readonly registrationId: string;
  private readonly client: HubJsonHttpClient;

  constructor(options: SyncHttpTransportOptions) {
    this.baseUrl = configuredUrl(options.baseUrl, options.allowInsecureHttpForTests === true);
    if (
      !PROJECT_PATTERN.test(options.target.projectId) ||
      !HASH_PATTERN.test(options.target.projectIdentityHash)
    )
      throw new Error("The Hub synchronization HTTP transport configuration is invalid.");
    this.destinationId = options.destinationId;
    this.target = { ...options.target };
    this.client = new HubJsonHttpClient({
      bearerToken: options.bearerToken,
      expectedHubIdentityHash: options.expectedHubIdentityHash,
      destinationId: options.destinationId,
      ...(options.maxRequestBytes === undefined
        ? {}
        : { maxRequestBytes: options.maxRequestBytes }),
      ...(options.maxResponseBytes === undefined
        ? {}
        : { maxResponseBytes: options.maxResponseBytes }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
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
    return this.client.requestJson({
      url,
      method: "GET",
      acceptedStatuses: [200],
      credentialMode: "none",
    });
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
    const url = new URL(
      `v1/sync/projects/${encodeURIComponent(this.target.projectId)}/${kind}`,
      this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`),
    );
    url.searchParams.set("destinationId", this.destinationId);
    url.searchParams.set("projectIdentityHash", this.target.projectIdentityHash);
    return this.client.requestJson({
      url,
      method,
      ...(body === undefined ? {} : { body }),
      acceptedStatuses,
      credentialMode: "bearer",
    });
  }
}
