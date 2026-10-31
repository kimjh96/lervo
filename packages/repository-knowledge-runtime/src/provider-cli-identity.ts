import { createHash } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";
import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import { PROVIDER_CLI_DISPATCH_POLICY } from "@lervo/repository-knowledge-compiler";
import type { ProviderCliDetectionPorts } from "./provider-cli-detection.js";
import { runProviderCliCommand } from "./provider-cli-command.js";
import { providerCliNeedsVersionCheck } from "./provider-cli-dispatch.js";

export type BackgroundProvider = "codex" | "claude";
export interface ProviderCliIdentity {
  provider: BackgroundProvider;
  executable: string;
  realPath: string;
  fingerprint: string;
  versionOutputHash: string | null;
  environment: NodeJS.ProcessEnv;
  version: string;
  executableHash: string;
  identityHash: string;
}
export async function executableRealPath(path: string): Promise<string | null> {
  if (!isAbsolute(path) || /[\x00-\x1f\x7f]/u.test(path)) return null;
  try {
    const target = await realpath(path);
    if (!(await stat(target)).isFile()) return null;
    await access(target, constants.X_OK);
    return target;
  } catch {
    return null;
  }
}
async function fingerprint(path: string): Promise<string> {
  const value = await stat(path, { bigint: true });
  return [value.dev, value.ino, value.size, value.mtimeNs].join(":");
}
export async function providerCliIdentityCurrent(identity: ProviderCliIdentity): Promise<boolean> {
  try {
    if (
      (await executableRealPath(identity.executable)) !== identity.realPath ||
      (await fingerprint(identity.realPath)) !== identity.fingerprint
    )
      return false;
    if (identity.versionOutputHash === null) return true;
    const result = await runProviderCliCommand(
      identity.executable,
      ["--version"],
      5_000,
      identity.environment,
    );
    return (
      result.status === "completed" &&
      sha256(result.stdout) === identity.versionOutputHash &&
      (await executableRealPath(identity.executable)) === identity.realPath &&
      (await fingerprint(identity.realPath)) === identity.fingerprint
    );
  } catch {
    return false;
  }
}
export function providerCliIdentityHash(
  identity: Omit<ProviderCliIdentity, "identityHash" | "fingerprint">,
): string {
  return sha256(
    canonicalJson([
      PROVIDER_CLI_DISPATCH_POLICY,
      identity.provider,
      identity.executable,
      identity.realPath,
      identity.version,
      identity.versionOutputHash,
      identity.executableHash,
      identity.environment,
    ]),
  );
}
export async function identifyProviderCli(
  provider: BackgroundProvider,
  executable: string,
  ports: ProviderCliDetectionPorts,
  environment: NodeJS.ProcessEnv,
  prior?: ProviderCliIdentity,
  versionObservation: "refresh_dispatch" | "reuse_detection" = "refresh_dispatch",
): Promise<ProviderCliIdentity | null> {
  const target = await executableRealPath(executable);
  if (target === null) return null;
  const before = await fingerprint(target);
  const invocationEnvironment = {
    ...environment,
    PATH: `${dirname(executable)}:${environment.PATH ?? "/usr/bin:/bin"}`,
  };
  const unchangedFile =
    prior !== undefined && prior.realPath === target && prior.fingerprint === before;
  const needsVersionCheck = await providerCliNeedsVersionCheck(executable, target);
  if (
    unchangedFile &&
    (versionObservation === "reuse_detection" ||
      (!needsVersionCheck && prior.versionOutputHash === null)) &&
    prior.executable === executable &&
    canonicalJson(prior.environment) === canonicalJson(invocationEnvironment)
  )
    return prior;
  let executableHash = prior?.executableHash ?? "";
  if (!unchangedFile) {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(target)) hash.update(chunk as Buffer);
    executableHash = `sha256:${hash.digest("hex")}`;
  }
  const result = await ports.command(executable, ["--version"], 5_000, invocationEnvironment);
  const version = result.stdout.match(
    /(?:^|\s)(\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]{1,40})?)(?=\s|$)/u,
  )?.[1];
  if (
    result.status !== "completed" ||
    version === undefined ||
    version.length > 80 ||
    (await fingerprint(target)) !== before ||
    (await executableRealPath(executable)) !== target
  )
    return null;
  const identity = {
    provider,
    executable,
    realPath: target,
    fingerprint: before,
    environment: invocationEnvironment,
    version,
    versionOutputHash: needsVersionCheck ? sha256(result.stdout) : null,
    executableHash,
  };
  return { ...identity, identityHash: providerCliIdentityHash(identity) };
}
