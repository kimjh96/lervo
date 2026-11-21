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

import {
  HUB_LEGACY_HOLD_DEADLINE_MILLISECONDS,
  HUB_OPEN_HOLD_DEADLINE_MILLISECONDS,
  holdHubRequest,
} from "./hub-held-request.js";
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
  private readonly bearerToken: string;
  private readonly expectedHubIdentityHash: string;

  constructor(options: SyncHttpTransportOptions) {
    this.baseUrl = configuredUrl(options.baseUrl, options.allowInsecureHttpForTests === true);
    if (
      !PROJECT_PATTERN.test(options.target.projectId) ||
      !HASH_PATTERN.test(options.target.projectIdentityHash)
    )
      throw new Error("The Hub synchronization HTTP transport configuration is invalid.");
    this.destinationId = options.destinationId;
    this.target = { ...options.target };
    this.bearerToken = options.bearerToken;
    this.expectedHubIdentityHash = options.expectedHubIdentityHash;
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

  /**
   * ADR-0602: an open hold. The Hub answers only when something changed (or at once for a stale
   * cursor), so an idle Node makes no request at all; TCP keepalive owns the connection's
   * liveness. A Hub older than ADR-0602 rejects `hold` as an invalid request.
   */
  async waitForRuntimeChange(input: {
    topic: "workstream" | "command";
    nodeId?: string;
    cursor: string | null;
    signal: AbortSignal;
    /** A Hub older than ADR-0602 refuses `hold`; this asks for its bounded hold instead. */
    legacy?: boolean;
  }): Promise<unknown> {
    const url = new URL(
      `v1/runtime-changes/projects/${encodeURIComponent(this.target.projectId)}`,
      this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`),
    );
    url.searchParams.set("destinationId", this.destinationId);
    url.searchParams.set("repositoryIdentityHash", this.target.projectIdentityHash);
    url.searchParams.set("topic", input.topic);
    if (input.nodeId !== undefined) url.searchParams.set("nodeId", input.nodeId);
    if (input.cursor !== null) url.searchParams.set("cursor", input.cursor);
    if (input.legacy !== true) url.searchParams.set("hold", "open");
    return holdHubRequest({
      url,
      bearerToken: this.bearerToken,
      expectedHubIdentityHash: this.expectedHubIdentityHash,
      destinationId: this.destinationId,
      signal: input.signal,
      deadlineMilliseconds:
        input.legacy === true
          ? HUB_LEGACY_HOLD_DEADLINE_MILLISECONDS
          : HUB_OPEN_HOLD_DEADLINE_MILLISECONDS,
    });
  }

  async readWorkstream(): Promise<unknown> {
    return this.requestJson("workstreams", "GET", undefined, [200]);
  }

  async readWorkstreamRevision(snapshotContentHash: string): Promise<unknown> {
    if (!/^sha256:[a-f0-9]{64}$/u.test(snapshotContentHash))
      throw new Error("The workstream revision hash is invalid.");
    return this.requestJson("workstreams", "GET", undefined, [200], { snapshotContentHash });
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
    query: Record<string, string> = {},
  ): Promise<unknown> {
    const url = new URL(
      `v1/sync/projects/${encodeURIComponent(this.target.projectId)}/${kind}`,
      this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`),
    );
    url.searchParams.set("destinationId", this.destinationId);
    url.searchParams.set("projectIdentityHash", this.target.projectIdentityHash);
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
    return this.client.requestJson({
      url,
      method,
      ...(body === undefined ? {} : { body }),
      acceptedStatuses,
      credentialMode: "bearer",
    });
  }
}
