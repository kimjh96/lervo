import type { RemoteCommandDeliveryAcknowledgement, RemoteCommandTarget } from "@lervo/schemas";

import type { AuthenticatedRemoteCommandHubTransport } from "./delivery-transport.js";
import { readRemoteCommandHttpJson, resolveRemoteCommandHttpResponseLimit } from "./http-json.js";

const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const NODE_PATTERN = /^node_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const PROJECT_PATTERN = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface RemoteCommandHttpTransportOptions {
  baseUrl: string;
  bearerToken: string;
  expectedHubIdentityHash: string;
  destinationId: string;
  nodeId: string;
  target: RemoteCommandTarget;
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
      "The remote command Hub URL must be an HTTPS URL without credentials or a query.",
    );
  return url;
}

function sameTarget(left: RemoteCommandTarget, right: RemoteCommandTarget): boolean {
  return (
    left.projectId === right.projectId && left.projectIdentityHash === right.projectIdentityHash
  );
}

function responseBody(
  value: unknown,
  expected: {
    destinationId: string;
    nodeId: string;
    target: RemoteCommandTarget;
    property: "leases" | "confirmation";
  },
): unknown {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("destinationId" in value) ||
    value.destinationId !== expected.destinationId ||
    !("nodeId" in value) ||
    value.nodeId !== expected.nodeId ||
    !("target" in value) ||
    typeof value.target !== "object" ||
    value.target === null ||
    !("projectId" in value.target) ||
    value.target.projectId !== expected.target.projectId ||
    !("projectIdentityHash" in value.target) ||
    value.target.projectIdentityHash !== expected.target.projectIdentityHash ||
    !(expected.property in value)
  )
    throw new Error("The remote command Hub response coordinates differ from the request.");
  return (value as Record<string, unknown>)[expected.property];
}

export class AuthenticatedRemoteCommandHttpTransport implements AuthenticatedRemoteCommandHubTransport {
  private readonly baseUrl: URL;
  private readonly maxResponseBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: RemoteCommandHttpTransportOptions) {
    this.baseUrl = configuredUrl(options.baseUrl, options.allowInsecureHttpForTests === true);
    if (
      options.bearerToken.length < 32 ||
      options.bearerToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/.test(options.bearerToken) ||
      !HASH_PATTERN.test(options.expectedHubIdentityHash) ||
      !DESTINATION_PATTERN.test(options.destinationId) ||
      !NODE_PATTERN.test(options.nodeId) ||
      !PROJECT_PATTERN.test(options.target.projectId) ||
      !HASH_PATTERN.test(options.target.projectIdentityHash)
    )
      throw new Error("The remote command HTTP transport configuration is invalid.");
    this.maxResponseBytes = resolveRemoteCommandHttpResponseLimit(options.maxResponseBytes);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    if (
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 10 ||
      this.requestTimeoutMs > 300_000
    )
      throw new Error("The remote command HTTP transport request timeout is invalid.");
    this.request = options.fetch ?? globalThis.fetch;
  }

  async pullRemoteCommands(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    nodeId: string;
    requestedAt: string;
    leaseDurationMs: number;
    limit: number;
  }): Promise<unknown> {
    if (
      input.destinationId !== this.options.destinationId ||
      input.nodeId !== this.options.nodeId ||
      !sameTarget(input.target, this.options.target) ||
      !Number.isFinite(Date.parse(input.requestedAt))
    )
      throw new Error(
        "The remote command HTTP pull coordinates differ from the transport configuration.",
      );
    return this.post("leases", {
      schemaVersion: 1,
      leaseDurationMs: input.leaseDurationMs,
      limit: input.limit,
    });
  }

  acknowledgeRemoteCommand(
    acknowledgement: RemoteCommandDeliveryAcknowledgement,
  ): Promise<unknown> {
    return this.post("acknowledgements", acknowledgement);
  }

  private async post(kind: "leases" | "acknowledgements", body: unknown): Promise<unknown> {
    const url = new URL(
      `v1/commands/projects/${encodeURIComponent(this.options.target.projectId)}/${kind}`,
      this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`),
    );
    url.searchParams.set("destinationId", this.options.destinationId);
    url.searchParams.set("projectIdentityHash", this.options.target.projectIdentityHash);
    url.searchParams.set("nodeId", this.options.nodeId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.request(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.options.bearerToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: JSON.stringify(body),
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status !== 200)
        throw new Error("The remote command Hub response status is invalid.");
      if (response.headers.get("x-lervo-hub-identity") !== this.options.expectedHubIdentityHash) {
        await response.body?.cancel();
        return {
          authentication: {
            status: "unverified",
            destinationId: this.options.destinationId,
            peerIdentityHash: null,
          },
          body: null,
        };
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        await response.body?.cancel();
        throw new Error("The remote command Hub response content type is invalid.");
      }
      const value = await readRemoteCommandHttpJson(response, this.maxResponseBytes);
      return {
        authentication: {
          status: "verified",
          destinationId: this.options.destinationId,
          peerIdentityHash: this.options.expectedHubIdentityHash,
        },
        body: responseBody(value, {
          destinationId: this.options.destinationId,
          nodeId: this.options.nodeId,
          target: this.options.target,
          property: kind === "leases" ? "leases" : "confirmation",
        }),
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
