import type { CapabilityPackageEnvelope } from "./envelope.js";
import { decodeCapabilityPackage } from "./envelope.js";
import type { CapabilityPublicationScope, PublishedCapabilityPackage } from "./registry.js";
import { CapabilityPackageError } from "./types.js";

function hubRoot(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new CapabilityPackageError(
      "capability_hub_failed",
      "The capability Hub URL is invalid.",
      { cause: error },
    );
  }
  const loopback =
    url.protocol === "http:" && ["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !loopback) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  )
    throw new CapabilityPackageError(
      "capability_hub_failed",
      "The capability Hub must be HTTPS, except for an explicit loopback development URL, and contain no credentials or query.",
    );
  url.pathname = url.pathname.replace(/\/$/u, "");
  return url;
}

function headers(token: string): Record<string, string> {
  if (token.length < 32 || token.length > 4096 || !/^[\x21-\x7e]+$/u.test(token))
    throw new CapabilityPackageError(
      "capability_hub_failed",
      "The capability Hub token format is invalid.",
    );
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

async function responseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > 20 * 1024 * 1024)
    throw new CapabilityPackageError(
      "capability_hub_failed",
      "The capability Hub response exceeded its limit.",
    );
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    throw new CapabilityPackageError(
      "capability_hub_failed",
      "The capability Hub returned invalid JSON.",
      { cause: error },
    );
  }
  if (!response.ok)
    throw new CapabilityPackageError(
      "capability_hub_failed",
      `The capability Hub request failed with HTTP ${response.status}.`,
    );
  return body;
}

export async function publishCapabilityPackage(input: {
  hubUrl: string;
  token: string;
  scope: CapabilityPublicationScope;
  package: CapabilityPackageEnvelope;
  fetch?: typeof globalThis.fetch;
}): Promise<unknown> {
  decodeCapabilityPackage(input.package);
  const url = hubRoot(input.hubUrl);
  url.pathname += "/v1/capabilities/package";
  const response = await (input.fetch ?? globalThis.fetch)(url, {
    method: "POST",
    headers: headers(input.token),
    body: JSON.stringify({ schemaVersion: 1, scope: input.scope, package: input.package }),
    redirect: "error",
  });
  return responseJson(response);
}

export async function pullCapabilityPackage(input: {
  hubUrl: string;
  token: string;
  scope: CapabilityPublicationScope;
  capabilityId: string;
  version: string;
  fetch?: typeof globalThis.fetch;
}): Promise<PublishedCapabilityPackage> {
  const url = hubRoot(input.hubUrl);
  url.pathname += "/v1/capabilities/package";
  url.searchParams.set("scope", input.scope.kind);
  if (input.scope.kind === "project") {
    url.searchParams.set("destinationId", input.scope.destinationId);
    url.searchParams.set("projectId", input.scope.projectId);
  }
  url.searchParams.set("capabilityId", input.capabilityId);
  url.searchParams.set("version", input.version);
  const body = await responseJson(
    await (input.fetch ?? globalThis.fetch)(url, {
      method: "GET",
      headers: headers(input.token),
      redirect: "error",
    }),
  );
  if (body === null || typeof body !== "object" || Array.isArray(body))
    throw new CapabilityPackageError(
      "capability_hub_failed",
      "The capability Hub publication is invalid.",
    );
  const record = body as PublishedCapabilityPackage;
  const verified = decodeCapabilityPackage(record.package);
  if (
    verified.manifest.capabilityId !== input.capabilityId ||
    verified.manifest.version !== input.version ||
    JSON.stringify(record.scope) !== JSON.stringify(input.scope)
  )
    throw new CapabilityPackageError(
      "capability_hub_failed",
      "The capability Hub returned a mismatched coordinate.",
    );
  return record;
}
