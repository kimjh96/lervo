import { dirname, resolve } from "node:path";

import { readOwnerOnlyText, RuntimeSecurityError } from "@lervo/runtime-security";

import type { NodeRuntimeConfig } from "./config-types.js";
import {
  configRecord,
  configText,
  exactConfigKeys,
  optionalConfigInteger,
} from "./config-values.js";
import { NodeRuntimeError } from "./errors.js";
import { parseRemoteCommandConfig } from "./remote-command-config.js";

const MAX_CONFIG_BYTES = 1_048_576;
const DESTINATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const WORKER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;

function httpsUrl(value: unknown): string {
  const raw = configText(value, "hub.baseUrl");
  let url: URL;
  try {
    url = new URL(raw);
  } catch (error) {
    throw new NodeRuntimeError("invalid_config", "hub.baseUrl is invalid.", {
      cause: error,
    });
  }
  if (
    url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
    url.search !== "" || url.hash !== ""
  ) {
    throw new NodeRuntimeError(
      "invalid_config",
      "hub.baseUrl must be an HTTPS URL without credentials or a query string.",
    );
  }
  return url.href;
}

export function parseNodeRuntimeConfig(value: unknown, baseDirectory: string): NodeRuntimeConfig {
  const source = configRecord(value, "Node runtime config");
  exactConfigKeys(source, ["schemaVersion", "repositoryRoot", "hub", "sync", "remoteCommands"], "Node runtime config");
  if (source.schemaVersion !== 1) {
    throw new NodeRuntimeError("invalid_config", "Node runtime config schemaVersion must be 1.");
  }
  const hub = configRecord(source.hub, "hub");
  exactConfigKeys(hub, ["baseUrl", "bearerTokenFile", "destinationId", "hubIdentityHash"], "hub");
  const destinationId = configText(hub.destinationId, "hub.destinationId");
  const hubIdentityHash = configText(hub.hubIdentityHash, "hub.hubIdentityHash");
  if (!DESTINATION_PATTERN.test(destinationId) || !HASH_PATTERN.test(hubIdentityHash)) {
    throw new NodeRuntimeError("invalid_config", "The Hub destination or identity is invalid.");
  }
  const sync = configRecord(source.sync, "sync");
  exactConfigKeys(sync, [
    "workerId",
    "idlePollIntervalMs",
    "leaseDurationMs",
    "retryDelayMs",
    "batchLimit",
    "requestTimeoutMs",
    "maxRequestBytes",
    "maxResponseBytes",
  ], "sync");
  const workerId = configText(sync.workerId, "sync.workerId");
  if (!WORKER_PATTERN.test(workerId)) {
    throw new NodeRuntimeError("invalid_config", "sync.workerId is invalid.");
  }
  const integer = (key: string, minimum: number, maximum: number) =>
    optionalConfigInteger(sync, key, minimum, maximum, "sync");
  const idlePollIntervalMs = integer("idlePollIntervalMs", 100, 60 * 60_000);
  const leaseDurationMs = integer("leaseDurationMs", 1, 86_400_000);
  const retryDelayMs = integer("retryDelayMs", 1, 86_400_000);
  const batchLimit = integer("batchLimit", 1, 100);
  const requestTimeoutMs = integer("requestTimeoutMs", 10, 300_000);
  const maxRequestBytes = integer("maxRequestBytes", 1_024, 16_777_216);
  const maxResponseBytes = integer("maxResponseBytes", 1_024, 16_777_216);
  const remoteCommands = source.remoteCommands === undefined
    ? undefined
    : parseRemoteCommandConfig(source.remoteCommands, baseDirectory);
  return {
    schemaVersion: 1,
    repositoryRoot: resolve(baseDirectory, configText(source.repositoryRoot, "repositoryRoot")),
    hub: {
      baseUrl: httpsUrl(hub.baseUrl),
      bearerTokenFile: resolve(baseDirectory, configText(hub.bearerTokenFile, "hub.bearerTokenFile")),
      destinationId,
      hubIdentityHash,
    },
    sync: {
      workerId,
      ...(idlePollIntervalMs === undefined ? {} : { idlePollIntervalMs }),
      ...(leaseDurationMs === undefined ? {} : { leaseDurationMs }),
      ...(retryDelayMs === undefined ? {} : { retryDelayMs }),
      ...(batchLimit === undefined ? {} : { batchLimit }),
      ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
      ...(maxRequestBytes === undefined ? {} : { maxRequestBytes }),
      ...(maxResponseBytes === undefined ? {} : { maxResponseBytes }),
    },
    ...(remoteCommands === undefined ? {} : { remoteCommands }),
  };
}

export async function loadNodeRuntimeConfig(path: string): Promise<NodeRuntimeConfig> {
  const absolutePath = resolve(path);
  let serialized: string;
  try {
    serialized = await readOwnerOnlyText(absolutePath, MAX_CONFIG_BYTES);
  } catch (error) {
    const code = error instanceof RuntimeSecurityError && error.code === "invalid_text"
      ? "invalid_config"
      : "unsafe_runtime_file";
    throw new NodeRuntimeError(code, "Could not read the Node runtime config file safely.", {
      cause: error,
    });
  }
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new NodeRuntimeError("invalid_config", "The Node runtime config is not valid JSON.", {
      cause: error,
    });
  }
  return parseNodeRuntimeConfig(value, dirname(absolutePath));
}
