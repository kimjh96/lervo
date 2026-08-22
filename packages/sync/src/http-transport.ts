import type {
  OutboundEventBatch,
  ProjectRegistrationRequest,
  RemoteCommandTarget,
} from "@lervo/schemas";
import {
  assertOutboundEventBatch,
  assertProjectRegistrationRequest,
  calculateProjectRegistrationId,
} from "@lervo/sync-contract";

import { readSyncHttpJson } from "./http-json.js";
import type { AuthenticatedHubTransport } from "./transport.js";

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
    url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== ""
  ) throw new Error("Hub sync URL은 credential·query가 없는 HTTPS URL이어야 합니다.");
  return url;
}

function byteLimit(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1_024 || resolved > MAXIMUM_HTTP_BYTES) {
    throw new Error(`${label}은 1024 이상 16777216 이하여야 합니다.`);
  }
  return resolved;
}

function sameTarget(left: RemoteCommandTarget, right: RemoteCommandTarget): boolean {
  return left.projectId === right.projectId &&
    left.projectIdentityHash === right.projectIdentityHash;
}

export class AuthenticatedHubHttpTransport implements AuthenticatedHubTransport {
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
      options.bearerToken.length < 32 || options.bearerToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/.test(options.bearerToken) ||
      !HASH_PATTERN.test(options.expectedHubIdentityHash) ||
      !DESTINATION_PATTERN.test(options.destinationId) ||
      !PROJECT_PATTERN.test(options.target.projectId) ||
      !HASH_PATTERN.test(options.target.projectIdentityHash)
    ) throw new Error("Hub sync HTTP transport 설정이 유효하지 않습니다.");
    this.bearerToken = options.bearerToken;
    this.expectedHubIdentityHash = options.expectedHubIdentityHash;
    this.destinationId = options.destinationId;
    this.target = { ...options.target };
    this.maxRequestBytes = byteLimit(
      options.maxRequestBytes,
      DEFAULT_MAX_REQUEST_BYTES,
      "Hub sync HTTP 요청 한도",
    );
    this.maxResponseBytes = byteLimit(
      options.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      "Hub sync HTTP 응답 한도",
    );
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 10 ||
      this.requestTimeoutMs > 300_000) {
      throw new Error("Hub sync HTTP 요청 제한 시간이 유효하지 않습니다.");
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
    ) throw new Error("Hub sync registration 좌표가 transport 설정과 다릅니다.");
    return this.post("registration", request, [200, 201]);
  }

  async sendEventBatch(batch: OutboundEventBatch): Promise<unknown> {
    assertOutboundEventBatch(batch);
    if (
      batch.destinationId !== this.destinationId ||
      batch.projectId !== this.target.projectId || batch.registrationId !== this.registrationId
    ) throw new Error("Hub sync event batch 좌표가 transport 설정과 다릅니다.");
    return this.post("event-batches", batch, [200]);
  }

  private async post(
    kind: "registration" | "event-batches",
    body: unknown,
    acceptedStatuses: readonly number[],
  ): Promise<unknown> {
    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, "utf8") > this.maxRequestBytes) {
      throw new Error("Hub sync 요청이 허용 크기를 넘었습니다.");
    }
    const url = new URL(
      `v1/sync/projects/${encodeURIComponent(this.target.projectId)}/${kind}`,
      this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`),
    );
    url.searchParams.set("destinationId", this.destinationId);
    url.searchParams.set("projectIdentityHash", this.target.projectIdentityHash);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.request(url, {
        method: "POST",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.bearerToken}`,
          "content-type": "application/json; charset=utf-8",
        },
        body: serialized,
        redirect: "error",
        signal: controller.signal,
      });
      if (!acceptedStatuses.includes(response.status)) {
        await response.body?.cancel();
        throw new Error("Hub sync 응답 상태가 유효하지 않습니다.");
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
        throw new Error("Hub sync 응답 content type이 유효하지 않습니다.");
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
