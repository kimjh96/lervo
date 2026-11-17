import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { canonicalJson } from "./integrity.js";
import { withProcessCostScope } from "./process-cost-observation.js";
import {
  repositoryScanFingerprintHolds,
  type RepositoryScanFingerprint,
} from "./scan-fingerprint.js";
import type { RepositoryKnowledgeScanInput } from "./scanner-intake.js";
import type { RepositoryKnowledgeScan } from "./types.js";

/**
 * Distinct scan inputs one command keeps. Upgrade inspections and lint scan with the same inputs;
 * the bound keeps a command that scans otherwise from holding many repository scans in memory.
 */
const MAXIMUM_REUSED_SCANS = 2;

export interface FingerprintedScan {
  scan: RepositoryKnowledgeScan;
  /** Null when an input of the scan cannot be observed again exactly. */
  fingerprint: RepositoryScanFingerprint | null;
}

type ScanReuseScope = Map<string, { root: string; scan: Promise<FingerprintedScan> }>;

const scopes = new AsyncLocalStorage<ScanReuseScope>();

/**
 * ADR-0582: inside `run`, a repository scan whose inputs equal an earlier scan's, and whose
 * fingerprint still holds, returns that earlier scan instead of reading the repository again. Each
 * reuse observes the fingerprint first, so an edit made by this command or by anyone else since
 * the earlier scan is read by a fresh scan. Scans are kept only for the duration of `run`.
 */
export function withRepositoryKnowledgeScanReuse<T>(run: () => Promise<T>): Promise<T> {
  return scopes.run(new Map(), run);
}

/**
 * The exact scan inputs. Injected observers or a source-unit cache describe a caller's own scan
 * and are never reused, so they have no key.
 */
function reuseKey(input: RepositoryKnowledgeScanInput): string | null {
  if (
    input.observeRevision !== undefined ||
    input.observeIgnoredPaths !== undefined ||
    input.sourceUnitCache !== undefined
  )
    return null;
  const hash = createHash("sha256");
  hash.update(
    canonicalJson({
      repositoryRoot: resolve(input.repositoryRoot),
      projectId: input.projectId,
      policy: input.policy,
      generatedPaths: input.generatedPaths === undefined ? null : [...input.generatedPaths].sort(),
      sourceUnitFailureMode: input.sourceUnitFailureMode ?? null,
    }),
  );
  hash.update(input.supplementalSources === undefined ? "\0none" : "\0sources");
  for (const source of input.supplementalSources ?? []) {
    // Field by field: tens of thousands of evidence pages make canonical serialization costly.
    const { content, path, kind, classification, origin, unitKind, locator, title, ...rest } =
      source;
    hash.update(
      `\0${JSON.stringify([path, kind, classification, origin, unitKind, locator, title, rest])}`,
    );
    hash.update(`\0${content.length}\0`);
    hash.update(content);
  }
  return hash.digest("hex");
}

async function reusable(
  previous: Promise<FingerprintedScan> | undefined,
): Promise<FingerprintedScan | null> {
  const entry = await previous?.catch(() => null);
  const fingerprint = entry?.fingerprint ?? null;
  if (entry === undefined || entry === null || fingerprint === null) return null;
  const holds = await withProcessCostScope("scan_reuse_check", () =>
    repositoryScanFingerprintHolds(fingerprint, entry.scan),
  );
  return holds ? entry : null;
}

/**
 * Returns a reusable scan of `input`, or scans with `scanFresh`. A fresh scan replaces the earlier
 * one before it starts, so a command never holds two scans of the same inputs.
 */
export async function reuseRepositoryKnowledgeScan(
  input: RepositoryKnowledgeScanInput,
  scanFresh: (recordFingerprint: boolean) => Promise<FingerprintedScan>,
): Promise<RepositoryKnowledgeScan> {
  const scope = scopes.getStore();
  const key = scope === undefined ? null : reuseKey(input);
  if (scope === undefined || key === null) return (await scanFresh(false)).scan;
  const root = resolve(input.repositoryRoot);
  let previous = scope.get(key)?.scan;
  const pending = (async (): Promise<FingerprintedScan> => {
    const entry = await reusable(previous);
    if (entry !== null) return entry;
    // A kept scan that no longer holds means the repository changed under every kept scan of it,
    // so they are all released before the replacement is read instead of doubling memory.
    if (previous !== undefined) {
      for (const [other, kept] of scope)
        if (other !== key && kept.root === root) scope.delete(other);
    }
    previous = undefined;
    return scanFresh(true);
  })();
  scope.delete(key);
  scope.set(key, { root, scan: pending });
  while (scope.size > MAXIMUM_REUSED_SCANS) scope.delete(scope.keys().next().value!);
  try {
    return (await pending).scan;
  } catch (error) {
    if (scope.get(key)?.scan === pending) scope.delete(key);
    throw error;
  }
}
