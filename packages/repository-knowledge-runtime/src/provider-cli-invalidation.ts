import { rm } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import { resolve } from "node:path";

import { isProviderCliAdmissionProjection } from "@lervo/sync-contract";

import { withProviderCliCacheLock } from "./provider-cli-cache-lock.js";
import {
  defaultProviderCliDetectionPorts,
  type BackgroundProvider,
} from "./provider-cli-detection.js";
import { PROVIDER_CLI_STATE_PATH } from "./provider-cli-projection.js";
import { readProviderCliCache, writeProviderCliCache } from "./provider-cli-store.js";
import { readPrivateJsonFile } from "./private-state-file.js";

/** A probe time every backoff has passed, so the next admission re-probes the entry. */
const DUE = new Date(0).toISOString();

/** How many recorded failures an explicit successful probe invalidated; counts only, no paths. */
export interface ProviderCliFailureInvalidation {
  hostCacheEntries: number;
  repositoryProjections: number;
}

/**
 * After an explicit native probe proved `provider` answers, forgets every recorded failure of it,
 * so no host waits out a failure observed before the owner logged the provider back in.
 *
 * - The host cache marks that provider's transient rejections due, so the next admission probes
 *   it once for the whole host and every other repository reuses that result. Each keeps its
 *   failure count, so a provider that fails again stays on the hourly backoff rather than
 *   restarting at one minute. An identity-bound capability rejection still needs a new identity.
 * - Each repository's admission projection that records the provider as not admitted is removed.
 *   It is a rebuildable projection; without it the owner verdict stops counting the provider as
 *   unadmitted on its next observation instead of an hour after the failure.
 *
 * Both run under the host cache lock that admission writes them under, so an admission running
 * meanwhile writes its own newer observation afterwards rather than being overwritten.
 */
export async function invalidateProviderCliFailures(input: {
  provider: BackgroundProvider;
  repositoryRoots: readonly string[];
  /** The host cache directory; defaults to `~/.lervo/state/provider-clis`. */
  directory?: string;
}): Promise<ProviderCliFailureInvalidation> {
  const directory =
    input.directory ??
    resolve(defaultProviderCliDetectionPorts().home, ".lervo/state/provider-clis");
  return withProviderCliCacheLock(directory, async () => {
    let hostCacheEntries = 0;
    const cache = await readProviderCliCache(directory);
    if (cache !== null) {
      const identities = new Set(
        cache.identities
          .filter((identity) => identity.provider === input.provider)
          .map((identity) => identity.identityHash),
      );
      const entries = cache.entries.map((entry) => {
        if (
          !identities.has(entry.identityHash) ||
          entry.result.admitted ||
          entry.result.reason === "capabilities_exposed" ||
          Date.parse(entry.probedAt) === 0
        )
          return entry;
        hostCacheEntries += 1;
        return { ...entry, probedAt: DUE };
      });
      if (hostCacheEntries > 0) await writeProviderCliCache(directory, { ...cache, entries });
    }
    let repositoryProjections = 0;
    for (const root of new Set(input.repositoryRoots)) {
      const path = resolve(root, PROVIDER_CLI_STATE_PATH);
      const file = await readPrivateJsonFile(path, 64 * 1024);
      if (
        file.status === "read" &&
        isProviderCliAdmissionProjection(file.value) &&
        file.value.providers.some((cli) => cli.provider === input.provider && !cli.admitted)
      ) {
        await rm(path, { force: true });
        repositoryProjections += 1;
      }
    }
    return { hostCacheEntries, repositoryProjections };
  });
}

/** The waits between attempts while an admission holds the host cache lock, about 3.75 seconds. */
export const PROVIDER_CLI_INVALIDATION_RETRY_MS: readonly number[] = [250, 500, 1000, 2000];

/**
 * {@link invalidateProviderCliFailures} as a best effort after a probe that already succeeded: an
 * admission holding the host cache lock is waited for within a small bound, and a cleanup that
 * still cannot run reports why instead of failing the probe, whose paid call already proved the
 * provider. The records it could not clear lapse on their own schedule.
 */
export async function tryInvalidateProviderCliFailures(
  input: Parameters<typeof invalidateProviderCliFailures>[0],
  retryMs: readonly number[] = PROVIDER_CLI_INVALIDATION_RETRY_MS,
): Promise<
  | { invalidated: ProviderCliFailureInvalidation; reason: null }
  | { invalidated: null; reason: string }
> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { invalidated: await invalidateProviderCliFailures(input), reason: null };
    } catch (error) {
      const code = (error as { code?: unknown }).code;
      const reason =
        typeof code === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(code)
          ? code
          : "provider_cli_invalidation_failed";
      const wait = retryMs[attempt];
      if (reason !== "knowledge_capacity_unavailable" || wait === undefined)
        return { invalidated: null, reason };
      await sleep(wait);
    }
  }
}
