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
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("The policy Hub URL must be an HTTPS URL without credentials or a query.");
  }
  return url;
}

async function boundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declared = response.headers.get("content-length");
  if (
    declared !== null &&
    (/^(0|[1-9][0-9]*)$/.test(declared) === false || Number(declared) > maxBytes)
  ) {
    throw new Error("The policy Hub response size is invalid.");
  }
  if (response.body === null) throw new Error("The policy Hub response body is missing.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteCount = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    byteCount += item.value.byteLength;
    if (byteCount > maxBytes) {
      await reader.cancel();
      throw new Error("The policy Hub response exceeds the allowed size.");
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
  } catch (error) {
    throw new Error("The policy Hub response is not UTF-8 JSON.", { cause: error });
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
      options.bearerToken.length < 32 ||
      options.bearerToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/.test(options.bearerToken) ||
      !/^sha256:[a-f0-9]{64}$/.test(options.expectedHubIdentityHash)
    )
      throw new Error("The policy HTTP transport credential or Hub identity is invalid.");
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    if (
      !Number.isSafeInteger(this.maxResponseBytes) ||
      this.maxResponseBytes < 1_024 ||
      this.maxResponseBytes > 16_777_216
    )
      throw new Error("The policy HTTP transport response limit is invalid.");
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 10 ||
      this.requestTimeoutMs > 300_000
    )
      throw new Error("The policy HTTP transport request timeout is invalid.");
    this.request = options.fetch ?? globalThis.fetch;
  }

  async pullPolicyBundle(input: {
    destinationId: string;
    target: RemoteCommandTarget;
    currentSnapshotId: string | null;
    requestedAt: string;
  }): Promise<unknown> {
    if (!Number.isFinite(Date.parse(input.requestedAt))) {
      throw new Error("The policy HTTP request time is invalid.");
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
      if (response.status !== 200) throw new Error("The policy Hub response status is invalid.");
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
        throw new Error("The policy Hub response content type is invalid.");
      }
      const body = await boundedJson(response, this.maxResponseBytes);
      if (
        typeof body !== "object" ||
        body === null ||
        !("schemaVersion" in body) ||
        body.schemaVersion !== 1 ||
        !("destinationId" in body) ||
        body.destinationId !== input.destinationId ||
        !("target" in body) ||
        typeof body.target !== "object" ||
        body.target === null ||
        !("projectId" in body.target) ||
        body.target.projectId !== input.target.projectId ||
        !("projectIdentityHash" in body.target) ||
        body.target.projectIdentityHash !== input.target.projectIdentityHash ||
        !("bundle" in body)
      )
        throw new Error("The policy Hub response coordinates differ from the request.");
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
