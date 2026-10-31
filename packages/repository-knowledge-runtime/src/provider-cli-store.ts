function privateEnvironment(value: unknown): value is NodeJS.ProcessEnv {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const env = value as Record<string, unknown>;
  return (
    Object.keys(env).sort().join() === "HOME,PATH,SHELL" &&
    Object.values(env).every(
      (item) => typeof item === "string" && item.length <= 16384 && !/[\x00-\x1f\x7f]/u.test(item),
    )
  );
}
import { providerCliIdentityHash } from "./provider-cli-identity.js";
import { providerCliExposedTools, providerCliRejectionReasons } from "@lervo/schemas";
import { resolve } from "node:path";
import type { ProviderCliProbeResult } from "@lervo/repository-knowledge-compiler";
import type { BackgroundProvider, ProviderCliIdentity } from "./provider-cli-detection.js";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

export interface ProviderCliCache {
  schemaVersion: 3;
  environment: NodeJS.ProcessEnv;
  detectedAt: string;
  paths: Record<BackgroundProvider, string[]>;
  detectionFailure: "login_shell_failed" | "login_shell_timed_out" | null;
  identities: ProviderCliIdentity[];
  entries: {
    identityHash: string;
    result: ProviderCliProbeResult;
    probedAt: string;
    failures: number;
  }[];
}
function validIdentity(identity: ProviderCliIdentity): boolean {
  return (
    identity !== null &&
    typeof identity === "object" &&
    ["codex", "claude"].includes(identity.provider) &&
    typeof identity.executable === "string" &&
    identity.executable.startsWith("/") &&
    typeof identity.version === "string" &&
    /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]{1,40})?$/u.test(identity.version) &&
    /^sha256:[a-f0-9]{64}$/u.test(identity.executableHash) &&
    typeof identity.realPath === "string" &&
    identity.realPath.startsWith("/") &&
    typeof identity.fingerprint === "string" &&
    /^\d+:\d+:\d+:\d+$/u.test(identity.fingerprint) &&
    (identity.versionOutputHash === null ||
      /^sha256:[a-f0-9]{64}$/u.test(identity.versionOutputHash)) &&
    privateEnvironment(identity.environment) &&
    identity.identityHash === providerCliIdentityHash(identity)
  );
}
export async function readProviderCliCache(directory: string): Promise<ProviderCliCache | null> {
  const file = await readPrivateJsonFile(resolve(directory, "current.json"), 512 * 1024);
  if (file.status !== "read") return null;
  const value = file.value as ProviderCliCache | null;
  if (
    value?.schemaVersion !== 3 ||
    !privateEnvironment(value.environment) ||
    !Number.isFinite(Date.parse(value.detectedAt)) ||
    !Array.isArray(value.identities) ||
    value.identities.length > 32 ||
    !value.identities.every(validIdentity) ||
    !Array.isArray(value.entries) ||
    value.entries.length > 32 ||
    ![value.paths?.codex, value.paths?.claude].every(
      (paths) =>
        Array.isArray(paths) &&
        paths.length <= 16 &&
        paths.every((path) => typeof path === "string"),
    ) ||
    ![null, "login_shell_failed", "login_shell_timed_out"].includes(value.detectionFailure) ||
    !value.entries.every((entry) => {
      const result = entry?.result;
      return (
        value.identities.some((identity) => identity.identityHash === entry?.identityHash) &&
        Number.isSafeInteger(entry.failures) &&
        entry.failures >= 0 &&
        entry.failures <= 32 &&
        Number.isFinite(Date.parse(entry.probedAt)) &&
        result &&
        (result.admitted === true
          ? /^sha256:[a-f0-9]{64}$/u.test(result.probeResultHash)
          : result.admitted === false &&
            providerCliRejectionReasons.includes(result.reason) &&
            Array.isArray(result.exposedTools) &&
            result.exposedTools.length <= 16 &&
            result.exposedTools.every((name) =>
              providerCliExposedTools.includes(name as (typeof providerCliExposedTools)[number]),
            ))
      );
    })
  )
    return null;
  return value;
}
export function writeProviderCliCache(directory: string, cache: ProviderCliCache): Promise<void> {
  return writePrivateJsonFile(resolve(directory, "current.json"), cache);
}

/** Optional owner override. No provider is installed or copied by Lervo. */
export async function readProviderCliOverrides(
  home: string,
): Promise<Partial<Record<BackgroundProvider, string>>> {
  const file = await readPrivateJsonFile(resolve(home, ".lervo/provider-clis.json"), 8 * 1024);
  if (file.status === "absent") return {};
  const value =
    file.status === "read"
      ? (file.value as { schemaVersion?: unknown; executables?: Record<string, unknown> })
      : null;
  if (
    value?.schemaVersion !== 1 ||
    value.executables === undefined ||
    typeof value.executables !== "object" ||
    Array.isArray(value.executables) ||
    Object.keys(value).sort().join() !== "executables,schemaVersion" ||
    value.executables === null ||
    !Object.entries(value.executables).every(
      ([provider, path]) =>
        ["codex", "claude"].includes(provider) && typeof path === "string" && path.startsWith("/"),
    )
  )
    throw Object.assign(new Error("Provider CLI overrides are invalid."), {
      code: "provider_cli_configuration_invalid",
    });
  return value.executables as Partial<Record<BackgroundProvider, string>>;
}
