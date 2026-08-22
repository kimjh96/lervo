import { dirname, resolve } from "node:path";

import {
  ConfiguredBearerAuthenticator,
  type HubBearerCredential,
  type HubPermission,
} from "@lervo/hub";

import type {
  HubRuntimeCleanupConfig,
  HubRuntimeConfig,
  HubRuntimeSigningConfig,
} from "./config-types.js";
import { HubRuntimeError } from "./errors.js";
import { readOwnerOnlyText } from "./secure-file.js";

const MAX_CONFIG_BYTES = 1_048_576;
const HUB_IDENTITY_HASH = /^sha256:[a-f0-9]{64}$/u;
const KEY_ID = /^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const PERMISSIONS = new Set<HubPermission>([
  "trace.read",
  "sync.write",
  "policy.read",
  "policy.write",
  "command.read",
  "command.write",
  "command.delivery",
  "approval.write",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HubRuntimeError("invalid_config", `${label}은 object여야 합니다.`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new HubRuntimeError("invalid_config", `${label}에 알 수 없는 필드가 있습니다.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096 || value.includes("\0")) {
    throw new HubRuntimeError("invalid_config", `${label}이 유효하지 않습니다.`);
  }
  return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new HubRuntimeError("invalid_config", `${label}이 유효하지 않습니다.`);
  }
  return value as number;
}

function optionalInteger(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
): number | undefined {
  return source[key] === undefined ? undefined : integer(source[key], minimum, maximum, key);
}

function configuredPath(value: unknown, base: string, label: string): string {
  return resolve(base, text(value, label));
}

function signing(value: unknown, base: string, label: string): HubRuntimeSigningConfig {
  const source = record(value, label);
  exact(source, ["keyId", "privateKeyPath"], label);
  const keyId = text(source.keyId, `${label}.keyId`);
  if (!KEY_ID.test(keyId)) throw new HubRuntimeError("invalid_config", `${label}.keyId가 유효하지 않습니다.`);
  return {
    keyId,
    privateKeyPath: configuredPath(source.privateKeyPath, base, `${label}.privateKeyPath`),
  };
}

function credentials(value: unknown): HubBearerCredential[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    throw new HubRuntimeError("invalid_config", "credentials는 1개 이상 256개 이하여야 합니다.");
  }
  return value.map((item, index) => {
    const source = record(item, `credentials[${index}]`);
    exact(source, ["token", "principalId", "permissions", "projects"], `credentials[${index}]`);
    if (!Array.isArray(source.permissions) || source.permissions.length < 1 ||
      source.permissions.some((permission) => typeof permission !== "string" ||
        !PERMISSIONS.has(permission as HubPermission))) {
      throw new HubRuntimeError("invalid_config", `credentials[${index}].permissions가 유효하지 않습니다.`);
    }
    if (!Array.isArray(source.projects)) {
      throw new HubRuntimeError("invalid_config", `credentials[${index}].projects가 유효하지 않습니다.`);
    }
    return {
      token: text(source.token, `credentials[${index}].token`),
      principalId: text(source.principalId, `credentials[${index}].principalId`),
      permissions: [...source.permissions] as HubPermission[],
      projects: source.projects.map((project, projectIndex) => {
        const coordinate = record(project, `credentials[${index}].projects[${projectIndex}]`);
        exact(coordinate, ["destinationId", "projectId"], "credential project");
        return {
          destinationId: text(coordinate.destinationId, "credential destinationId"),
          projectId: text(coordinate.projectId, "credential projectId"),
        };
      }),
    };
  });
}

function cleanup(value: unknown): HubRuntimeCleanupConfig {
  const source = record(value, "cleanup");
  exact(source, [
    "workerId",
    "leaseDurationMs",
    "cycleIntervalMs",
    "continuationDelayMs",
    "retryDelayMs",
    "orphanGraceMs",
    "limit",
    "maximumScannedObjects",
  ], "cleanup");
  const workerId = text(source.workerId, "cleanup.workerId");
  if (!WORKER_ID.test(workerId)) {
    throw new HubRuntimeError("invalid_config", "cleanup.workerId가 유효하지 않습니다.");
  }
  const result: HubRuntimeCleanupConfig = { workerId };
  const leaseDurationMs = optionalInteger(source, "leaseDurationMs", 1_000, 30 * 60_000);
  const cycleIntervalMs = optionalInteger(source, "cycleIntervalMs", 60_000, 24 * 60 * 60_000);
  const continuationDelayMs = optionalInteger(source, "continuationDelayMs", 100, 60_000);
  const retryDelayMs = optionalInteger(source, "retryDelayMs", 1_000, 60 * 60_000);
  const orphanGraceMs = optionalInteger(source, "orphanGraceMs", 60_000, 30 * 24 * 60 * 60_000);
  const limit = optionalInteger(source, "limit", 1, 100);
  const maximumScannedObjects = optionalInteger(source, "maximumScannedObjects", 1, 1_000_000);
  if (maximumScannedObjects !== undefined && maximumScannedObjects < (limit ?? 100)) {
    throw new HubRuntimeError(
      "invalid_config",
      "cleanup.maximumScannedObjects는 cleanup.limit 이상이어야 합니다.",
    );
  }
  if (leaseDurationMs !== undefined) result.leaseDurationMs = leaseDurationMs;
  if (cycleIntervalMs !== undefined) result.cycleIntervalMs = cycleIntervalMs;
  if (continuationDelayMs !== undefined) result.continuationDelayMs = continuationDelayMs;
  if (retryDelayMs !== undefined) result.retryDelayMs = retryDelayMs;
  if (orphanGraceMs !== undefined) result.orphanGraceMs = orphanGraceMs;
  if (limit !== undefined) result.limit = limit;
  if (maximumScannedObjects !== undefined) result.maximumScannedObjects = maximumScannedObjects;
  return result;
}

export function parseHubRuntimeConfig(value: unknown, baseDirectory: string): HubRuntimeConfig {
  const source = record(value, "Hub runtime config");
  exact(source, [
    "schemaVersion", "listen", "storage", "identity", "credentials", "signing", "control", "cleanup",
  ], "Hub runtime config");
  if (source.schemaVersion !== 1) {
    throw new HubRuntimeError("invalid_config", "Hub runtime config schemaVersion은 1이어야 합니다.");
  }
  const listen = record(source.listen, "listen");
  exact(listen, ["host", "port"], "listen");
  if (listen.host !== "127.0.0.1" && listen.host !== "::1") {
    throw new HubRuntimeError(
      "invalid_config",
      "TLS가 없는 Hub runtime은 loopback 주소에서만 실행할 수 있습니다.",
    );
  }
  const storage = record(source.storage, "storage");
  exact(storage, ["databasePath", "commandCasPath"], "storage");
  const identity = record(source.identity, "identity");
  exact(identity, ["hubIdentityHash"], "identity");
  const hubIdentityHash = text(identity.hubIdentityHash, "identity.hubIdentityHash");
  if (!HUB_IDENTITY_HASH.test(hubIdentityHash)) {
    throw new HubRuntimeError("invalid_config", "identity.hubIdentityHash가 유효하지 않습니다.");
  }
  const signingSource = record(source.signing, "signing");
  exact(signingSource, ["policy", "command"], "signing");
  const controlSource = record(source.control, "control");
  exact(controlSource, ["reviewGrantSecretPath", "reviewGrantTtlSeconds"], "control");
  const ttl = optionalInteger(controlSource, "reviewGrantTtlSeconds", 1, 3_600);
  const parsedCredentials = credentials(source.credentials);
  try {
    new ConfiguredBearerAuthenticator(parsedCredentials);
  } catch (error) {
    throw new HubRuntimeError("invalid_config", "Hub runtime credential이 유효하지 않습니다.", {
      cause: error,
    });
  }
  return {
    schemaVersion: 1,
    listen: {
      host: listen.host,
      port: integer(listen.port, 1, 65_535, "listen.port"),
    },
    storage: {
      databasePath: configuredPath(storage.databasePath, baseDirectory, "storage.databasePath"),
      commandCasPath: configuredPath(storage.commandCasPath, baseDirectory, "storage.commandCasPath"),
    },
    identity: { hubIdentityHash },
    credentials: parsedCredentials,
    signing: {
      policy: signing(signingSource.policy, baseDirectory, "signing.policy"),
      command: signing(signingSource.command, baseDirectory, "signing.command"),
    },
    control: {
      reviewGrantSecretPath: configuredPath(
        controlSource.reviewGrantSecretPath,
        baseDirectory,
        "control.reviewGrantSecretPath",
      ),
      ...(ttl === undefined ? {} : { reviewGrantTtlSeconds: ttl }),
    },
    cleanup: cleanup(source.cleanup),
  };
}

export async function loadHubRuntimeConfig(path: string): Promise<HubRuntimeConfig> {
  const absolutePath = resolve(path);
  const serialized = await readOwnerOnlyText(absolutePath, MAX_CONFIG_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch (error) {
    throw new HubRuntimeError("invalid_config", "Hub runtime config JSON이 유효하지 않습니다.", {
      cause: error,
    });
  }
  return parseHubRuntimeConfig(value, dirname(absolutePath));
}
