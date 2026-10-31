import { resolve } from "node:path";
import type { ProjectStorage } from "@lervo/project-storage";
import type { ProviderCliProbeResult } from "@lervo/repository-knowledge-compiler";
import type { ProviderCliAdmissionProjection, ProviderCliObservation } from "@lervo/sync-contract";
export type { ProviderCliAdmissionProjection } from "@lervo/sync-contract";
import {
  defaultProviderCliDetectionPorts,
  identifyProviderCli,
  type BackgroundProvider,
  type ProviderCliDetectionPorts,
  type ProviderCliIdentity,
} from "./provider-cli-detection.js";
import { detectProviderCliPaths } from "./provider-cli-detection.js";
import { readProviderCliCache, readProviderCliOverrides } from "./provider-cli-store.js";
export const PROVIDER_CLI_REFRESH_MS = 60_000;
import { PROVIDER_CLI_STATE_PATH, providerCliProjection } from "./provider-cli-projection.js";
export { PROVIDER_CLI_STATE_PATH } from "./provider-cli-projection.js";
import { writeProviderCliCache, type ProviderCliCache } from "./provider-cli-store.js";
import { writePrivateJsonFile } from "./private-state-file.js";
import { recordProviderCliAdmission } from "./provider-cli-events.js";
import { withProviderCliCacheLock } from "./provider-cli-cache-lock.js";
import { probeOnce } from "./provider-cli-probe-guard.js";
import type { KnowledgeProviderAdmissionState } from "./provider-admission.js";
import { providerCliProbePaused } from "./provider-cli-probe-failure.js";

export interface ResolveProviderCliInput {
  storage: ProjectStorage;
  preferred: BackgroundProvider;
  allowed: readonly BackgroundProvider[];
  executable?: string;
  directory?: string;
  hostLabel?: string;
  ports?: ProviderCliDetectionPorts;
  admissionMode?: "probe" | "cached";
  probe?: (identity: ProviderCliIdentity) => Promise<ProviderCliProbeResult>;
  providerPaused?: (
    provider: BackgroundProvider,
  ) => Promise<boolean | KnowledgeProviderAdmissionState>;
  now?: Date;
}

/** Cached observers cannot enter the writer's lock or probe path. */
export async function resolveAdmittedProviderCli(
  input: ResolveProviderCliInput,
): Promise<{ selected: ProviderCliIdentity | null; projection: ProviderCliAdmissionProjection }> {
  if (input.admissionMode === "cached") return admitProviderCli(input);
  const directory =
    input.directory ??
    resolve((input.ports ?? defaultProviderCliDetectionPorts()).home, ".lervo/state/provider-clis");
  return withProviderCliCacheLock(directory, () => admitProviderCli({ ...input, directory }));
}

async function admitProviderCli(input: ResolveProviderCliInput) {
  const ports = input.ports ?? defaultProviderCliDetectionPorts();
  const now = input.now ?? new Date();
  const directory = input.directory ?? resolve(ports.home, ".lervo/state/provider-clis");
  const prior = await readProviderCliCache(directory);
  const fresh =
    prior !== null &&
    now.getTime() - Date.parse(prior.detectedAt) >= 0 &&
    now.getTime() - Date.parse(prior.detectedAt) < PROVIDER_CLI_REFRESH_MS;
  const detected = fresh
    ? { paths: prior.paths, environment: prior.environment, failure: prior.detectionFailure }
    : await detectProviderCliPaths(ports);
  const overrides = await readProviderCliOverrides(ports.home);
  if (input.executable !== undefined) overrides[input.preferred] = input.executable;
  const order = [
    ...new Set([input.preferred, ...input.allowed, "codex" as const, "claude" as const]),
  ];
  const identified = new Set<string>();
  const entries: ProviderCliCache["entries"] = [];
  const identities: ProviderCliIdentity[] = [];
  const observations: ProviderCliObservation[] = [];
  let selected: ProviderCliIdentity | null = null;
  for (const provider of order) {
    const pause = await input.providerPaused?.(provider);
    let paused = typeof pause === "boolean" ? pause : pause?.paused === true;
    const reprobe =
      paused &&
      typeof pause === "object" &&
      pause.resetAt === null &&
      pause.nextReprobeAt !== null &&
      Date.parse(pause.nextReprobeAt) <= now.getTime() &&
      input.admissionMode !== "cached" &&
      selected === null &&
      input.allowed.includes(provider);
    if (reprobe) paused = false;
    const paths = [
      ...new Set([
        ...(overrides[provider] === undefined ? [] : [overrides[provider]!]),
        ...detected.paths[provider],
      ]),
    ].slice(0, 16);
    for (const path of paths) {
      const previous = prior?.identities.find(
        (identity) => identity.provider === provider && identity.executable === path,
      );
      const identity: ProviderCliIdentity | null = await identifyProviderCli(
        provider,
        path,
        ports,
        detected.environment,
        previous,
        selected === null && input.allowed.includes(provider) && !paused
          ? "refresh_dispatch"
          : "reuse_detection",
      ).catch(() => null);
      if (identity === null || identified.has(identity.identityHash)) continue;
      identified.add(identity.identityHash);
      identities.push(identity);
      const cached = prior?.entries.find((entry) => entry.identityHash === identity.identityHash);
      if (
        paused ||
        (cached === undefined &&
          (!input.allowed.includes(provider) ||
            input.admissionMode === "cached" ||
            selected !== null))
      ) {
        if (cached !== undefined) entries.push(cached);
        observations.push({
          provider,
          version: identity.version,
          executableHash: identity.executableHash,
          admitted: false,
          reason: null,
          exposedTools: [],
        });
        continue;
      }
      const retry =
        input.admissionMode !== "cached" &&
        selected === null &&
        input.allowed.includes(provider) &&
        cached !== undefined &&
        !cached.result.admitted &&
        cached.result.reason !== "capabilities_exposed" &&
        now.getTime() - Date.parse(cached.probedAt) >=
          Math.min(60 * 60_000, PROVIDER_CLI_REFRESH_MS * 2 ** Math.max(0, cached.failures - 1));
      let entry = cached;
      const capabilityRejected =
        cached !== undefined &&
        !cached.result.admitted &&
        cached.result.reason === "capabilities_exposed";
      if (cached === undefined || retry || (reprobe && selected === null && !capabilityRejected)) {
        let result: ProviderCliProbeResult;
        try {
          result = await probeOnce(identity, input.probe);
        } catch (error) {
          if (!providerCliProbePaused(error)) throw error;
          paused = true;
          if (cached !== undefined) entries.push(cached);
          observations.push({
            provider,
            version: identity.version,
            executableHash: identity.executableHash,
            admitted: false,
            reason: null,
            exposedTools: [],
          });
          continue;
        }
        entry = {
          identityHash: identity.identityHash,
          result,
          probedAt: now.toISOString(),
          failures: Math.min(32, (cached?.failures ?? 0) + 1),
        };
        const after = await identifyProviderCli(
          provider,
          identity.executable,
          ports,
          detected.environment,
          identity,
        ).catch(() => null);
        if (after?.identityHash !== identity.identityHash)
          entry = {
            identityHash: identity.identityHash,
            result: { admitted: false, reason: "identity_changed", exposedTools: [] },
            probedAt: now.toISOString(),
            failures: Math.min(32, (cached?.failures ?? 0) + 1),
          };
      }
      if (entry === undefined) continue;
      if (entry.result.admitted) {
        entry = { ...entry, failures: 0 };
        if (selected === null && input.allowed.includes(provider)) selected = identity;
      }
      entries.push(entry);
      observations.push({
        provider,
        version: identity.version,
        executableHash: identity.executableHash,
        admitted: entry.result.admitted,
        reason: entry.result.admitted ? null : entry.result.reason,
        exposedTools: entry.result.admitted ? [] : entry.result.exposedTools,
      });
      if (input.admissionMode !== "cached")
        recordProviderCliAdmission(
          input.storage,
          { ...entry, identity },
          input.hostLabel ?? (process.platform === "darwin" ? "macos" : "linux"),
        );
    }
  }
  if (input.admissionMode !== "cached")
    await writeProviderCliCache(directory, {
      schemaVersion: 3,
      environment: detected.environment,
      detectedAt: fresh ? prior!.detectedAt : now.toISOString(),
      paths: detected.paths,
      detectionFailure: detected.failure,
      identities,
      entries,
    });
  const projection = await providerCliProjection(
    input.storage.paths.repositoryRoot,
    now,
    detected.failure,
    observations,
    selected === null,
  );
  if (input.admissionMode !== "cached")
    await writePrivateJsonFile(
      resolve(input.storage.paths.repositoryRoot, PROVIDER_CLI_STATE_PATH),
      projection,
    );
  return { selected, projection };
}
