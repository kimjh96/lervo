import type { RemoteCommandTarget } from "@lervo/schemas";

import type { AuthenticatedPolicyHubTransport } from "./sync.js";

const DEFAULT_MAX_RESPONSE_BYTES = 1_048_576;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

export interface PolicyHttpTransportOptions {
  baseUrl: string;
  bearerToken: string;
  expectedHubIdentityHash: string;
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
  ) {
    throw new Error("Policy Hub URL은 credential·query가 없는 HTTPS URL이어야 합니다.");
  }
  return url;
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (declared !== null && (/^(0|[1-9][0-9]*)$/.test(declared) === false || Number(declared) > maxBytes)) {
    throw new Error("Policy Hub 응답 크기가 유효하지 않습니다.");
  }
  if (response.body === null) throw new Error("Policy Hub 응답 본문이 없습니다.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    byteCount += item.value.byteLength;
    if (byteCount > maxBytes) {
      await reader.cancel();
      throw new Error("Policy Hub 응답이 허용 크기를 넘었습니다.");
    }
    chunks.push(item.value);
  }
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("Policy Hub 응답이 UTF-8 JSON이 아닙니다.");
  }
}

export class AuthenticatedPolicyHttpTransport implements AuthenticatedPolicyHubTransport {
  private readonly baseUrl: URL;
  private readonly maxResponseBytes: number;
  private readonly requestTimeoutMs: number;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: PolicyHttpTransportOptions) {
    this.baseUrl = configuredUrl(options.baseUrl, options.allowInsecureHttpForTests === true);
    if (
      options.bearerToken.length < 32 || options.bearerToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/.test(options.bearerToken) ||
      !/^sha256:[a-f0-9]{64}$/.test(options.expectedHubIdentityHash)
    ) throw new Error("Policy HTTP transport credential 또는 Hub identity가 유효하지 않습니다.");
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (
      !Number.isSafeInteger(this.maxResponseBytes) ||
      this.maxResponseBytes < 1_024 ||
      this.maxResponseBytes > 16_777_216
    ) throw new Error("Policy HTTP transport 응답 한도가 유효하지 않습니다.");
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 10 ||
      this.requestTimeoutMs > 300_000
    ) throw new Error("Policy HTTP transport 요청 제한 시간이 유효하지 않습니다.");
    this.request = options.fetch ?? globalThis.fetch;
  }

  async pullPolicyBundle(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    currentSnapshotId: string | null;
    requestedAt: string;
  }): Promise<unknown> {
    if (!Number.isFinite(Date.parse(input.requestedAt))) {
      throw new Error("Policy HTTP 요청 시각이 유효하지 않습니다.");
    }
    const url = new URL(
      `v1/policy/projects/${encodeURIComponent(input.target.projectId)}/bundle`,
      this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`),
    );
    url.searchParams.set("destinationId", input.destinationId);
    url.searchParams.set("projectIdentityHash", input.target.projectIdentityHash);
    if (input.currentSnapshotId !== null) {
      url.searchParams.set("currentSnapshotId", input.currentSnapshotId);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.request(url, {
        method: "GET",
        headers: {
          accept: "application/json",
          authorization: `Bearer ${this.options.bearerToken}`,
        },
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status !== 200) throw new Error("Policy Hub 응답 상태가 유효하지 않습니다.");
      if (response.headers.get("x-lervo-hub-identity") !== this.options.expectedHubIdentityHash) {
        await response.body?.cancel();
        return {
          authentication: {
            status: "unverified",
            destinationId: input.destinationId,
            peerIdentityHash: null,
          },
          body: null,
        };
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        await response.body?.cancel();
        throw new Error("Policy Hub 응답 content type이 유효하지 않습니다.");
      }
      const body = await boundedJson(response, this.maxResponseBytes);
      if (
        typeof body !== "object" || body === null ||
        !("schemaVersion" in body) || body.schemaVersion !== 1 ||
        !("destinationId" in body) || body.destinationId !== input.destinationId ||
        !("target" in body) || typeof body.target !== "object" || body.target === null ||
        !("projectId" in body.target) || body.target.projectId !== input.target.projectId ||
        !("projectIdentityHash" in body.target) ||
        body.target.projectIdentityHash !== input.target.projectIdentityHash ||
        !("bundle" in body)
      ) throw new Error("Policy Hub 응답 좌표가 요청과 다릅니다.");
      return {
        authentication: {
          status: "verified",
          destinationId: input.destinationId,
          peerIdentityHash: this.options.expectedHubIdentityHash,
        },
        body: body.bundle,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
