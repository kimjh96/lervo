import { createHash } from "node:crypto";

import { type RemoteCommandPayloadReference, type RemoteCommandTarget } from "@lervo/schemas";

import type { RemoteCommandPayloadLoader } from "./types.js";

const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const NODE_PATTERN = /^node_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const PROJECT_PATTERN = /^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

export interface RemoteCommandHttpPayloadLoaderOptions {
  baseUrl: string;
  bearerToken: string;
  expectedHubIdentityHash: string;
  destinationId: string;
  nodeId: string;
  target: RemoteCommandTarget;
  requestTimeoutMs?: number;
  allowInsecureHttpForTests?: boolean;
  fetch?: typeof globalThis.fetch;
}

function configuredUrl(value: string, allowInsecure: boolean): URL {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && !(allowInsecure && url.protocol === "http:")) ||
    url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== ""
  ) throw new Error("The remote command artifact Hub URL must be an HTTPS URL without credentials or a query.");
  return url;
}

async function boundedBytes(response: Response, maximum: number): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared === null || !/^(0|[1-9][0-9]*)$/.test(declared) || Number(declared) !== maximum) {
    throw new Error("The remote command artifact response size differs from the source coordinates.");
  }
  if (response.body === null) throw new Error("The remote command artifact response body is missing.");
  const reader = response.body.getReader();
  const output = new Uint8Array(maximum);
  let offset = 0;
  while (true) {
    const item = await reader.read();
    if (item.done) break;
    if (offset + item.value.byteLength > maximum) {
      await reader.cancel();
      throw new Error("The remote command artifact response exceeds the allowed size.");
    }
    output.set(item.value, offset);
    offset += item.value.byteLength;
  }
  if (offset !== maximum) throw new Error("The remote command artifact response is incomplete.");
  return output;
}

function assertPayloadReference(reference: RemoteCommandPayloadReference): void {
  if (
    !/^art_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/.test(reference.artifactId) ||
    !HASH_PATTERN.test(reference.contentHash) ||
    !Number.isSafeInteger(reference.byteCount) || reference.byteCount < 1 ||
    reference.byteCount > 65_536 || reference.mediaType !== "text/plain; charset=utf-8"
  ) throw new Error("The remote command artifact reference is invalid.");
}

export class AuthenticatedRemoteCommandHttpPayloadLoader implements RemoteCommandPayloadLoader {
  private readonly baseUrl: URL;
  private readonly requestTimeoutMs: number;
  private readonly request: typeof globalThis.fetch;

  constructor(private readonly options: RemoteCommandHttpPayloadLoaderOptions) {
    this.baseUrl = configuredUrl(options.baseUrl, options.allowInsecureHttpForTests === true);
    if (
      options.bearerToken.length < 32 || options.bearerToken.length > 4_096 ||
      !/^[\x21-\x7e]+$/.test(options.bearerToken) ||
      !HASH_PATTERN.test(options.expectedHubIdentityHash) ||
      !DESTINATION_PATTERN.test(options.destinationId) || !NODE_PATTERN.test(options.nodeId) ||
      !PROJECT_PATTERN.test(options.target.projectId) ||
      !HASH_PATTERN.test(options.target.projectIdentityHash)
    ) throw new Error("The remote command artifact HTTP loader configuration is invalid.");
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    if (!Number.isSafeInteger(this.requestTimeoutMs) || this.requestTimeoutMs < 10 ||
      this.requestTimeoutMs > 300_000) {
      throw new Error("The remote command artifact HTTP timeout is invalid.");
    }
    this.request = options.fetch ?? globalThis.fetch;
  }

  async load(reference: RemoteCommandPayloadReference): Promise<Uint8Array> {
    assertPayloadReference(reference);
    const url = new URL(
      `v1/commands/projects/${encodeURIComponent(this.options.target.projectId)}/artifacts/${encodeURIComponent(reference.artifactId)}`,
      this.baseUrl.href.endsWith("/") ? this.baseUrl : new URL(`${this.baseUrl.href}/`),
    );
    url.searchParams.set("destinationId", this.options.destinationId);
    url.searchParams.set("projectIdentityHash", this.options.target.projectIdentityHash);
    url.searchParams.set("nodeId", this.options.nodeId);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.request(url, {
        method: "GET",
        headers: {
          accept: reference.mediaType,
          authorization: `Bearer ${this.options.bearerToken}`,
        },
        redirect: "error",
        signal: controller.signal,
      });
      if (response.status !== 200) throw new Error("The remote command artifact Hub response status is invalid.");
      if (
        response.headers.get("x-lervo-hub-identity") !== this.options.expectedHubIdentityHash ||
        response.headers.get("x-lervo-artifact-id") !== reference.artifactId ||
        response.headers.get("x-lervo-content-hash") !== reference.contentHash ||
        response.headers.get("content-type")?.toLowerCase() !== reference.mediaType
      ) {
        await response.body?.cancel();
        throw new Error("The remote command artifact Hub response coordinates differ from the request.");
      }
      const bytes = await boundedBytes(response, reference.byteCount);
      const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      if (contentHash !== reference.contentHash) {
        throw new Error("The remote command artifact response hash differs from the source coordinates.");
      }
      new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return bytes;
    } finally {
      clearTimeout(timeout);
    }
  }
}
