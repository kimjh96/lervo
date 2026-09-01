import { HubJsonHttpClient } from "./hub-json-http-client.js";
import type { AuthenticatedHubCapabilityTransport } from "./transport.js";

export interface HubCapabilityHttpTransportOptions {
  baseUrl: string;
  expectedHubIdentityHash: string;
  destinationId: string;
  maxResponseBytes?: number;
  requestTimeoutMs?: number;
  allowInsecureHttpForTests?: boolean;
  fetch?: typeof globalThis.fetch;
}

function capabilityUrl(value: string, allowInsecure: boolean): URL {
  const base = new URL(value);
  if (
    (base.protocol !== "https:" && !(allowInsecure && base.protocol === "http:")) ||
    base.username !== "" ||
    base.password !== "" ||
    base.search !== "" ||
    base.hash !== ""
  ) {
    throw new Error("The Hub capability URL must be HTTPS without credentials or a query.");
  }
  return new URL(
    "v1/health/capabilities",
    base.href.endsWith("/") ? base : new URL(`${base.href}/`),
  );
}

export class HubCapabilityHttpTransport implements AuthenticatedHubCapabilityTransport {
  private readonly url: URL;
  private readonly client: HubJsonHttpClient;

  constructor(options: HubCapabilityHttpTransportOptions) {
    this.url = capabilityUrl(options.baseUrl, options.allowInsecureHttpForTests === true);
    this.client = new HubJsonHttpClient({
      expectedHubIdentityHash: options.expectedHubIdentityHash,
      destinationId: options.destinationId,
      ...(options.maxResponseBytes === undefined
        ? {}
        : { maxResponseBytes: options.maxResponseBytes }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.fetch === undefined ? {} : { fetch: options.fetch }),
    });
  }

  readEventReaderCapabilities(): Promise<unknown> {
    return this.client.requestJson({
      url: this.url,
      method: "GET",
      acceptedStatuses: [200],
      credentialMode: "none",
    });
  }
}
