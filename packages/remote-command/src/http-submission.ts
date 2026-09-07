import {
  isRemoteContinuationCoordinate,
  validateSchema,
  type RemoteCommandTarget,
  type SignedRemoteCommand,
} from "@lervo/schemas";
import type { RemoteContinuationCoordinate } from "@lervo/schemas";

import { readRemoteCommandHttpJson, resolveRemoteCommandHttpResponseLimit } from "./http-json.js";

const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const PROJECT_PATTERN = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const DELIVERY_PATTERN = /^rcd_[a-f0-9]{64}$/u;

export interface RemoteCommandHttpSubmissionOptions {
  baseUrl: string;
  bearerToken: string;
  expectedHubIdentityHash: string;
  destinationId: string;
  target: RemoteCommandTarget;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
  allowInsecureHttpForTests?: boolean;
  fetch?: typeof globalThis.fetch;
}

export interface RemoteCommandSubmissionResult {
  status: "created" | "duplicate";
  destinationId: string;
  target: RemoteCommandTarget;
  deliveryId: string;
  queuedAt: string;
  envelope: SignedRemoteCommand;
}

export interface RemoteCommandSubmissionRequest {
  idempotencyKey: string;
  lifetimeMs: number;
  roleId: string;
  provider: string;
  risk: "low" | "medium" | "high";
  verificationSuiteIds: string[];
  request: string;
  continuation?: RemoteContinuationCoordinate;
}

function configuredUrl(value: string, allowInsecure: boolean): URL {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:")) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error(
      "The remote command submission Hub URL must be HTTPS without credentials or a query.",
    );
  }
  return url;
}

function parseSubmissionResult(
  value: unknown,
  expected: Pick<RemoteCommandHttpSubmissionOptions, "destinationId" | "target">,
): RemoteCommandSubmissionResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("The remote command submission response is invalid.");
  }
  const result = value as Partial<RemoteCommandSubmissionResult> & { schemaVersion?: unknown };
  if (
    result.schemaVersion !== 1 ||
    (result.status !== "created" && result.status !== "duplicate") ||
    result.destinationId !== expected.destinationId ||
    result.target?.projectId !== expected.target.projectId ||
    result.target.projectIdentityHash !== expected.target.projectIdentityHash ||
    typeof result.deliveryId !== "string" ||
    !DELIVERY_PATTERN.test(result.deliveryId) ||
    typeof result.queuedAt !== "string" ||
    !Number.isFinite(Date.parse(result.queuedAt)) ||
    !validateSchema("signedRemoteCommand", result.envelope).valid ||
    result.envelope?.command.target.projectId !== expected.target.projectId ||
    result.envelope.command.target.projectIdentityHash !== expected.target.projectIdentityHash
  ) {
    throw new Error("The remote command submission response coordinates are invalid.");
  }
  return structuredClone(result as RemoteCommandSubmissionResult);
}

export class AuthenticatedRemoteCommandHttpSubmission {
  private readonly baseUrl: URL;
  private readonly maxResponseBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: RemoteCommandHttpSubmissionOptions) {
    this.baseUrl = configuredUrl(options.baseUrl, options.allowInsecureHttpForTests === true);
    if (
      options.bearerToken.length < 32 ||
      options.bearerToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/u.test(options.bearerToken) ||
      !HASH_PATTERN.test(options.expectedHubIdentityHash) ||
      !DESTINATION_PATTERN.test(options.destinationId) ||
      !PROJECT_PATTERN.test(options.target.projectId) ||
      !HASH_PATTERN.test(options.target.projectIdentityHash)
    ) {
      throw new Error("The remote command HTTP submission configuration is invalid.");
    }
    this.maxResponseBytes = resolveRemoteCommandHttpResponseLimit(options.maxResponseBytes);
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    if (
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 10 ||
      this.requestTimeoutMs > 300_000
    ) {
      throw new Error("The remote command HTTP submission timeout is invalid.");
    }
    this.request = options.fetch ?? globalThis.fetch;
  }

  async submit(request: RemoteCommandSubmissionRequest): Promise<RemoteCommandSubmissionResult> {
    if (
      !/^idk_[A-Za-z0-9][A-Za-z0-9_-]{15,63}$/u.test(request.idempotencyKey) ||
      !Number.isSafeInteger(request.lifetimeMs) ||
      request.lifetimeMs < 1_000 ||
      request.lifetimeMs > 5 * 60_000 ||
      !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(request.roleId) ||
      request.roleId.length > 100 ||
      !/^[a-z][a-z0-9_-]{0,63}$/u.test(request.provider) ||
      !["low", "medium", "high"].includes(request.risk) ||
      request.verificationSuiteIds.length < 1 ||
      request.verificationSuiteIds.length > 16 ||
      new Set(request.verificationSuiteIds).size !== request.verificationSuiteIds.length ||
      request.verificationSuiteIds.some(
        (suiteId) => suiteId.length > 150 || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(suiteId),
      ) ||
      request.request.trim().length === 0 ||
      Buffer.byteLength(request.request) > 65_536 ||
      request.request.includes("\0") ||
      (request.continuation !== undefined && !isRemoteContinuationCoordinate(request.continuation))
    ) {
      throw new Error("The remote command submission request is invalid.");
    }
    const url = new URL(
      `v1/commands/projects/${encodeURIComponent(this.options.target.projectId)}/submissions`,
      this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`),
    );
    url.searchParams.set("destinationId", this.options.destinationId);
    url.searchParams.set("projectIdentityHash", this.options.target.projectIdentityHash);
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
        body: JSON.stringify({ schemaVersion: 1, ...request }),
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status !== 200 && response.status !== 201) {
        await response.body?.cancel();
        throw new Error("The remote command submission response status is invalid.");
      }
      if (response.headers.get("x-lervo-hub-identity") !== this.options.expectedHubIdentityHash) {
        await response.body?.cancel();
        throw new Error("The remote command submission Hub identity is unverified.");
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        await response.body?.cancel();
        throw new Error("The remote command submission response content type is invalid.");
      }
      return parseSubmissionResult(
        await readRemoteCommandHttpJson(response, this.maxResponseBytes),
        this.options,
      );
    } finally {
      clearTimeout(timeout);
    }
  }
}
