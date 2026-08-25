import { isIP } from "node:net";
import { relative, resolve, sep } from "node:path";

import {
  validateSchema,
  type AdapterCapabilityActivationRequest,
  type McpRuntimeDescriptor,
} from "@lervo/schemas";

import { CapabilityPackageError, type ResolvedCapabilityPackage } from "./types.js";

function fail(message: string, cause?: unknown): never {
  throw new CapabilityPackageError(
    "capability_unsupported",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function decodeJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch (error) {
    return fail(`${label} is not valid UTF-8 JSON.`, error);
  }
}

function safePackagePath(root: string, value: string): string {
  const path = resolve(root, value);
  const child = relative(root, path);
  if (child === "" || child === ".." || child.startsWith(`..${sep}`)) {
    fail("A capability activation path escaped its immutable package root.");
  }
  return path;
}

function httpUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    return fail("An MCP HTTP transport URL is invalid.", error);
  }
  const host = url.hostname.toLowerCase();
  const loopback =
    host === "localhost" ||
    host === "::1" ||
    host === "[::1]" ||
    host.startsWith("127.") ||
    (isIP(host) === 6 && host === "::1");
  if (
    url.username !== "" ||
    url.password !== "" ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback))
  ) {
    fail("MCP HTTP transports require HTTPS, or HTTP on a loopback host, without URL credentials.");
  }
  return url.toString();
}

function mcpActivation(value: ResolvedCapabilityPackage): AdapterCapabilityActivationRequest {
  const entrypoint = value.manifest.entrypoint;
  if (entrypoint.kind !== "mcp_server")
    fail("The resolved MCP activation entrypoint is inconsistent.");
  const file = value.files.find((item) => item.path === entrypoint.runtimeDescriptorPath);
  if (file === undefined) fail("An MCP capability is missing its runtime descriptor.");
  const decoded = decodeJson(file.bytes, entrypoint.runtimeDescriptorPath);
  if (!validateSchema("mcpRuntimeDescriptor", decoded).valid) {
    fail("An MCP runtime descriptor does not satisfy the provider-neutral v1 contract.");
  }
  const descriptor = decoded as McpRuntimeDescriptor;
  if (descriptor.transport.kind === "stdio") {
    const transport = descriptor.transport;
    const entrypointPath = safePackagePath(value.directoryPath, transport.entrypointPath);
    if (!value.files.some((item) => item.path === transport.entrypointPath)) {
      fail("An MCP stdio entrypoint is not part of the immutable package.");
    }
    return {
      kind: "capability_activation_request",
      schemaVersion: 1,
      capabilityId: value.manifest.capabilityId,
      capabilityKind: "mcp_server",
      version: value.manifest.version,
      contentHash: value.manifest.contentHash,
      runtime: {
        kind: "mcp_stdio",
        serverName: descriptor.serverName,
        command: transport.command,
        arguments: [entrypointPath, ...transport.arguments],
        credentialNames: [...entrypoint.credentialNames],
        timeoutMs: transport.timeoutMs,
      },
    };
  }
  const credential = descriptor.transport.bearerTokenCredential;
  const declared = [...entrypoint.credentialNames];
  if (
    (credential === null && declared.length !== 0) ||
    (credential !== null && (declared.length !== 1 || declared[0] !== credential))
  ) {
    fail("An MCP HTTP bearer credential must exactly match the package credential declaration.");
  }
  return {
    kind: "capability_activation_request",
    schemaVersion: 1,
    capabilityId: value.manifest.capabilityId,
    capabilityKind: "mcp_server",
    version: value.manifest.version,
    contentHash: value.manifest.contentHash,
    runtime: {
      kind: "mcp_http",
      serverName: descriptor.serverName,
      url: httpUrl(descriptor.transport.url),
      bearerTokenCredential: credential,
      timeoutMs: descriptor.transport.timeoutMs,
    },
  };
}

function pluginActivation(value: ResolvedCapabilityPackage): AdapterCapabilityActivationRequest {
  const entrypoint = value.manifest.entrypoint;
  if (entrypoint.kind !== "provider_plugin")
    fail("The resolved plugin activation entrypoint is inconsistent.");
  const expectedPath =
    entrypoint.provider === "codex" ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json";
  if (entrypoint.pluginManifestPath !== expectedPath) {
    fail(`A ${entrypoint.provider} plugin must use its native ${expectedPath} manifest.`);
  }
  const file = value.files.find((item) => item.path === entrypoint.pluginManifestPath);
  if (file === undefined) fail("A provider plugin manifest is missing from the immutable package.");
  const decoded = decodeJson(file.bytes, entrypoint.pluginManifestPath);
  if (
    typeof decoded !== "object" ||
    decoded === null ||
    Array.isArray(decoded) ||
    typeof (decoded as { name?: unknown }).name !== "string" ||
    (decoded as { name: string }).name.length === 0 ||
    (decoded as { version?: unknown }).version !== value.manifest.version
  ) {
    fail("A provider plugin requires a native name and an exact outer-package version.");
  }
  return {
    kind: "capability_activation_request",
    schemaVersion: 1,
    capabilityId: value.manifest.capabilityId,
    capabilityKind: "provider_plugin",
    version: value.manifest.version,
    contentHash: value.manifest.contentHash,
    runtime: {
      kind: "provider_plugin",
      provider: entrypoint.provider,
      pluginRoot: value.directoryPath,
      pluginManifestPath: entrypoint.pluginManifestPath,
    },
  };
}

export function createCapabilityActivationRequests(
  packages: readonly ResolvedCapabilityPackage[],
): AdapterCapabilityActivationRequest[] {
  const result = packages.flatMap((value) => {
    if (value.manifest.kind === "mcp_server") return [mcpActivation(value)];
    if (value.manifest.kind === "provider_plugin") return [pluginActivation(value)];
    return [];
  });
  const serverNames = result.flatMap((item) =>
    item.runtime.kind === "mcp_stdio" || item.runtime.kind === "mcp_http"
      ? [item.runtime.serverName]
      : [],
  );
  if (new Set(serverNames).size !== serverNames.length)
    fail("Resolved MCP capabilities contain duplicate provider server names.");
  for (const item of result) {
    if (!validateSchema("adapterCapabilityActivationRequest", item).valid) {
      fail("A resolved provider capability activation request is invalid.");
    }
  }
  return result.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
}
