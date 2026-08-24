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
export const MAX_CREDENTIALS_FILE_BYTES = 1_048_576;
const HUB_IDENTITY_HASH = /^sha256:[a-f0-9]{64}$/u;
const KEY_ID = /^key_[A-Za-z0-9][A-Za-z0-9._-]{7,63}$/u;
const WORKER_ID = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/u;
const PERMISSIONS = new Set<HubPermission>([
  "trace.read",
  "sync.write",
  "workstream.read",
  "workstream.write",
  "policy.read",
  "policy.write",
  "command.read",
  "command.write",
  "command.delivery",
  "approval.write",
]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new HubRuntimeError("invalid_config", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(value: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new HubRuntimeError("invalid_config", `${label} contains unknown fields.`);
  }
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 4_096 || value.includes("\0")) {
    throw new HubRuntimeError("invalid_config", `${label} is invalid.`);
  }
  return value;
}

function integer(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new HubRuntimeError("invalid_config", `${label} is invalid.`);
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

export function parseHubRuntimeSigningConfig(
  value: unknown,
  base: string,
  label: string,
): HubRuntimeSigningConfig {
  const source = record(value, label);
  exact(source, ["keyId", "privateKeyPath"], label);
  const keyId = text(source.keyId, `${label}.keyId`);
  if (!KEY_ID.test(keyId)) throw new HubRuntimeError("invalid_config", `${label}.keyId is invalid.`);
  return {
    keyId,
    privateKeyPath: configuredPath(source.privateKeyPath, base, `${label}.privateKeyPath`),
  };
}

export function parseHubBearerCredentials(value: unknown): HubBearerCredential[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 256) {
    throw new HubRuntimeError("invalid_config", "credentials must contain between 1 and 256 entries.");
  }
  return value.map((item, index) => {
    const source = record(item, `credentials[${index}]`);
    exact(source, ["token", "principalId", "permissions", "projects"], `credentials[${index}]`);
    if (!Array.isArray(source.permissions) || source.permissions.length < 1 ||
      source.permissions.some((permission) => typeof permission !== "string" ||
        !PERMISSIONS.has(permission as HubPermission))) {
      throw new HubRuntimeError("invalid_config", `credentials[${index}].permissions is invalid.`);
    }
    if (!Array.isArray(source.projects)) {
      throw new HubRuntimeError("invalid_config", `credentials[${index}].projects is invalid.`);
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
    throw new HubRuntimeError("invalid_config", "cleanup.workerId is invalid.");
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
      "cleanup.maximumScannedObjects must be greater than or equal to cleanup.limit.",
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
    "schemaVersion", "listen", "tls", "storage", "identity", "credentials", "credentialsFile", "signing", "signingFile", "control", "cleanup",
  ], "Hub runtime config");
  if (source.schemaVersion !== 1) {
    throw new HubRuntimeError("invalid_config", "Hub runtime config schemaVersion must be 1.");
  }
  const listen = record(source.listen, "listen");
  exact(listen, ["host", "port"], "listen");
  const listenHost = text(listen.host, "listen.host");
  if (
    listenHost.length > 255 || listenHost.trim() !== listenHost ||
    /[\s/\\]/u.test(listenHost)
  ) {
    throw new HubRuntimeError("invalid_config", "listen.host is invalid.");
  }
  const tlsSource = source.tls === undefined ? undefined : record(source.tls, "tls");
  if (tlsSource !== undefined) exact(tlsSource, ["certificatePath", "privateKeyPath"], "tls");
  if (tlsSource === undefined && listenHost !== "127.0.0.1" && listenHost !== "::1") {
    throw new HubRuntimeError(
      "invalid_config",
      "A Hub runtime without TLS may listen only on a loopback address.",
    );
  }
  const storage = record(source.storage, "storage");
  exact(storage, ["databasePath", "commandCasPath"], "storage");
  const identity = record(source.identity, "identity");
  exact(identity, ["hubIdentityHash"], "identity");
  const hubIdentityHash = text(identity.hubIdentityHash, "identity.hubIdentityHash");
  if (!HUB_IDENTITY_HASH.test(hubIdentityHash)) {
    throw new HubRuntimeError("invalid_config", "identity.hubIdentityHash is invalid.");
  }
  const hasInlineSigning = source.signing !== undefined;
  const hasSigningFile = source.signingFile !== undefined;
  if (hasInlineSigning === hasSigningFile) {
    throw new HubRuntimeError(
      "invalid_config",
      "Exactly one of signing or signingFile is required.",
    );
  }
  const signingSource = hasInlineSigning ? record(source.signing, "signing") : undefined;
  if (signingSource !== undefined) exact(signingSource, ["policy", "command"], "signing");
  const controlSource = record(source.control, "control");
  exact(controlSource, ["reviewGrantSecretPath", "reviewGrantTtlSeconds"], "control");
  const ttl = optionalInteger(controlSource, "reviewGrantTtlSeconds", 1, 3_600);
  const hasInlineCredentials = source.credentials !== undefined;
  const hasCredentialsFile = source.credentialsFile !== undefined;
  if (hasInlineCredentials === hasCredentialsFile) {
    throw new HubRuntimeError(
      "invalid_config",
      "Exactly one of credentials or credentialsFile is required.",
    );
  }
  const parsedCredentials = hasInlineCredentials
    ? parseHubBearerCredentials(source.credentials)
    : undefined;
  if (parsedCredentials !== undefined) {
    try {
      new ConfiguredBearerAuthenticator(parsedCredentials);
    } catch (error) {
      throw new HubRuntimeError("invalid_config", "A Hub runtime credential is invalid.", {
        cause: error,
      });
    }
  }
  return {
    schemaVersion: 1,
    listen: {
      host: listenHost,
      port: integer(listen.port, 1, 65_535, "listen.port"),
    },
    ...(tlsSource === undefined ? {} : {
      tls: {
        certificatePath: configuredPath(tlsSource.certificatePath, baseDirectory, "tls.certificatePath"),
        privateKeyPath: configuredPath(tlsSource.privateKeyPath, baseDirectory, "tls.privateKeyPath"),
      },
    }),
    storage: {
      databasePath: configuredPath(storage.databasePath, baseDirectory, "storage.databasePath"),
      commandCasPath: configuredPath(storage.commandCasPath, baseDirectory, "storage.commandCasPath"),
    },
    identity: { hubIdentityHash },
    ...(parsedCredentials === undefined ? {} : { credentials: parsedCredentials }),
    ...(hasCredentialsFile ? {
      credentialsFile: configuredPath(source.credentialsFile, baseDirectory, "credentialsFile"),
    } : {}),
    ...(signingSource === undefined ? {} : {
      signing: {
        policy: parseHubRuntimeSigningConfig(signingSource.policy, baseDirectory, "signing.policy"),
        command: parseHubRuntimeSigningConfig(signingSource.command, baseDirectory, "signing.command"),
      },
    }),
    ...(hasSigningFile ? {
      signingFile: configuredPath(source.signingFile, baseDirectory, "signingFile"),
    } : {}),
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
    throw new HubRuntimeError("invalid_config", "The Hub runtime config is not valid JSON.", {
      cause: error,
    });
  }
  return parseHubRuntimeConfig(value, dirname(absolutePath));
}
