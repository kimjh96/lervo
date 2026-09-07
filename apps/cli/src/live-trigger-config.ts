import { isAbsolute, relative, resolve } from "node:path";

import {
  parseLiveWebhookAuthorization,
  type LiveWebhookAuthorizationV1,
} from "@lervo/live-trigger-contract";
import { readOwnerOnlyText } from "@lervo/runtime-security";

export interface LiveWebhookServerConfigV1 {
  schemaVersion: 1;
  repositoryRoot: string;
  authorizationFile: string;
  listen: { host: "127.0.0.1" | "::1"; port: number; path: string };
  credential: { credentialId: string; secretEnvironmentVariable: string };
  maximumBodyBytes: number;
  maximumClockSkewMs: number;
  maximumConcurrentRequests: number;
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return (
    actual.length === sortedExpected.length &&
    actual.every((key, index) => key === sortedExpected[index])
  );
}

function parseConfig(value: unknown, configPath: string): LiveWebhookServerConfigV1 {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("The live webhook config must be an object.");
  const source = value as Record<string, unknown>;
  const listen = source.listen as Record<string, unknown> | undefined;
  const credential = source.credential as Record<string, unknown> | undefined;
  const allowedKeys = new Set([
    "authorizationFile",
    "credential",
    "listen",
    "maximumBodyBytes",
    "maximumClockSkewMs",
    "maximumConcurrentRequests",
    "repositoryRoot",
    "schemaVersion",
  ]);
  if (
    !["authorizationFile", "credential", "listen", "repositoryRoot", "schemaVersion"].every(
      (key) => key in source,
    ) ||
    Object.keys(source).some((key) => !allowedKeys.has(key)) ||
    source.schemaVersion !== 1 ||
    typeof source.repositoryRoot !== "string" ||
    source.repositoryRoot.length === 0 ||
    typeof source.authorizationFile !== "string" ||
    isAbsolute(source.authorizationFile) ||
    listen === undefined ||
    !exactKeys(listen, ["host", "path", "port"]) ||
    (listen.host !== "127.0.0.1" && listen.host !== "::1") ||
    !Number.isSafeInteger(listen.port) ||
    (listen.port as number) < 0 ||
    (listen.port as number) > 65_535 ||
    typeof listen.path !== "string" ||
    !/^\/[A-Za-z0-9/_-]{1,255}$/u.test(listen.path) ||
    credential === undefined ||
    !exactKeys(credential, ["credentialId", "secretEnvironmentVariable"]) ||
    typeof credential.credentialId !== "string" ||
    !/^[a-z][a-z0-9._-]{0,127}$/u.test(credential.credentialId) ||
    typeof credential.secretEnvironmentVariable !== "string" ||
    !/^[A-Z][A-Z0-9_]{2,127}$/u.test(credential.secretEnvironmentVariable) ||
    (source.maximumBodyBytes !== undefined &&
      (!Number.isSafeInteger(source.maximumBodyBytes) ||
        (source.maximumBodyBytes as number) < 1 ||
        (source.maximumBodyBytes as number) > 1024 * 1024)) ||
    (source.maximumClockSkewMs !== undefined &&
      (!Number.isSafeInteger(source.maximumClockSkewMs) ||
        (source.maximumClockSkewMs as number) < 1 ||
        (source.maximumClockSkewMs as number) > 15 * 60_000)) ||
    (source.maximumConcurrentRequests !== undefined &&
      (!Number.isSafeInteger(source.maximumConcurrentRequests) ||
        (source.maximumConcurrentRequests as number) < 1 ||
        (source.maximumConcurrentRequests as number) > 256))
  )
    throw new Error("The live webhook config is invalid or exceeds its bounds.");
  const repositoryRoot = resolve(resolve(configPath, ".."), source.repositoryRoot);
  const authorizationFile = resolve(repositoryRoot, source.authorizationFile);
  const relativeAuthorization = relative(repositoryRoot, authorizationFile);
  if (
    relativeAuthorization.startsWith("..") ||
    isAbsolute(relativeAuthorization) ||
    !/^\.lervo\/[A-Za-z0-9._-]+\.json$/u.test(relativeAuthorization)
  )
    throw new Error(
      "The live webhook authorization must be a direct JSON child of the repository .lervo directory.",
    );
  return {
    schemaVersion: 1,
    repositoryRoot,
    authorizationFile,
    listen: listen as unknown as LiveWebhookServerConfigV1["listen"],
    credential: credential as unknown as LiveWebhookServerConfigV1["credential"],
    maximumBodyBytes: (source.maximumBodyBytes as number | undefined) ?? 64 * 1024,
    maximumClockSkewMs: (source.maximumClockSkewMs as number | undefined) ?? 300_000,
    maximumConcurrentRequests: (source.maximumConcurrentRequests as number | undefined) ?? 16,
  };
}

export async function loadLiveWebhookServerConfig(
  path: string,
): Promise<LiveWebhookServerConfigV1> {
  const absolutePath = resolve(path);
  let value: unknown;
  try {
    value = JSON.parse(await readOwnerOnlyText(absolutePath, 64 * 1024));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("The live webhook config must be valid JSON.", { cause: error });
    throw error;
  }
  return parseConfig(value, absolutePath);
}

export async function loadLiveWebhookAuthorization(
  path: string,
): Promise<LiveWebhookAuthorizationV1> {
  let value: unknown;
  try {
    value = JSON.parse(await readOwnerOnlyText(path, 256 * 1024));
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new Error("The live webhook authorization must be valid JSON.", { cause: error });
    throw error;
  }
  return parseLiveWebhookAuthorization(value);
}
