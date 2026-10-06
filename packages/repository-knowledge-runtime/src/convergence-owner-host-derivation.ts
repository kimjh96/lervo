import { randomBytes } from "node:crypto";
import { resolve } from "node:path";

import { canonicalJson, sha256 } from "@lervo/repository-knowledge";
import type { KnowledgeConvergenceOwnerFailure } from "@lervo/sync-contract";

import {
  CONVERGENCE_OWNER_HOST_PATH,
  parseConvergenceOwnerHostConfig,
  readConvergenceOwnerHost,
  type ConvergenceOwnerHostConfig,
  type ConvergenceOwnerHubCoordinates,
} from "./convergence-owner-host.js";
import type { KnowledgePublicationSettings } from "./knowledge-publication-settings.js";
import { readPrivateJsonFile, writePrivateJsonFile } from "./private-state-file.js";

/**
 * ADR-0469 zero-touch owner-host configuration. A checkout whose host configuration was created
 * automatically (or never created) follows the Hub coordinates this host already uses for sync;
 * an operator-written configuration is never changed. The marker records which configuration
 * Lervo wrote, so a later hand edit is recognized as operator-owned.
 */
export const CONVERGENCE_OWNER_HOST_DERIVATION_PATH =
  ".lervo/state/knowledge/convergence-owner-host-derivation.json";

const PUBLICATION_PROBE_INTERVAL_MS = 6 * 60 * 60_000;

export type ConvergenceOwnerHubSource = "node_runtime" | "host_repository";

export interface ConvergenceOwnerHubCandidate {
  source: ConvergenceOwnerHubSource;
  hub: ConvergenceOwnerHubCoordinates;
}

interface DerivationMarker {
  schemaVersion: 1;
  configHash: string;
  source: ConvergenceOwnerHubSource | "none";
  derivedAt: string;
  publicationProbedAt: string | null;
  /** ADR-0470: the written Hub coordinates failed their probe; re-probe them every round. */
  unproven?: true;
}

export type ConvergenceOwnerHostOrigin = "absent" | "legacy_default" | "automatic" | "operator";

export type ConvergenceOwnerHostDerivation =
  | { status: "operator" }
  | { status: "invalid" }
  | { status: "unchanged"; mode: "hub" | "standalone"; source: ConvergenceOwnerHubSource | "none" }
  | { status: "derived"; mode: "hub" | "standalone"; source: ConvergenceOwnerHubSource | "none" };

export interface ConvergenceOwnerHostDerivationResult {
  derivation: ConvergenceOwnerHostDerivation;
  /** The last Hub probe that kept this host standalone; null when no probe failed. */
  hubFailure: KnowledgeConvergenceOwnerFailure | null;
  publication: "configured" | "unavailable" | "not_applicable";
}

export function convergenceOwnerHostConfigHash(config: ConvergenceOwnerHostConfig): string {
  return sha256(canonicalJson(config));
}

/** Pure: whether Lervo may rewrite this host configuration. */
export function convergenceOwnerHostOrigin(
  config: ConvergenceOwnerHostConfig | null,
  marker: { configHash: string } | null,
): ConvergenceOwnerHostOrigin {
  if (config === null) return "absent";
  if (marker !== null && marker.configHash === convergenceOwnerHostConfigHash(config))
    return "automatic";
  if (
    marker === null &&
    config.coordination.mode === "standalone" &&
    config.hostLabel === "local" &&
    config.publication === undefined
  )
    return "legacy_default";
  return "operator";
}

/** Pure: the operator-facing label for this host, never a hostname when a role name fits. */
export function convergenceHostLabel(input: {
  platform: NodeJS.Platform;
  release: string;
  hostname: string;
}): string {
  if (input.platform === "darwin") return "mac";
  if (input.platform === "linux" && /microsoft/iu.test(input.release)) return "wsl";
  const label = input.hostname
    .toLowerCase()
    .replace(/[^a-z0-9-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32);
  return /^[a-z0-9][a-z0-9-]{0,31}$/u.test(label) ? label : "host";
}

async function readMarker(root: string): Promise<DerivationMarker | null> {
  const file = await readPrivateJsonFile(
    resolve(root, CONVERGENCE_OWNER_HOST_DERIVATION_PATH),
    4_096,
  );
  if (file.status !== "read") return null;
  const value = file.value as Partial<DerivationMarker> | null;
  return value?.schemaVersion === 1 &&
    typeof value.configHash === "string" &&
    typeof value.derivedAt === "string" &&
    (value.publicationProbedAt === null || typeof value.publicationProbedAt === "string") &&
    ["node_runtime", "host_repository", "none"].includes(String(value.source))
    ? (value as DerivationMarker)
    : null;
}

/**
 * Derives and writes this checkout's owner-host configuration when Lervo owns it. Hub mode is
 * chosen only after a probe proves the candidate coordinates are usable for this project, so a
 * working standalone host never degrades into `unverifiable`. Publication is enabled only in Hub
 * mode and only when the host's own `gh` session can serve it.
 */
export async function deriveConvergenceOwnerHost(input: {
  root: string;
  candidates: readonly ConvergenceOwnerHubCandidate[];
  probe: (hub: ConvergenceOwnerHubCoordinates) => Promise<KnowledgeConvergenceOwnerFailure | null>;
  publication: () => Promise<KnowledgePublicationSettings | null>;
  hostLabel: string;
  now: Date;
  random?: () => string;
}): Promise<ConvergenceOwnerHostDerivationResult> {
  let current: ConvergenceOwnerHostConfig | null;
  try {
    current = (await readConvergenceOwnerHost(input.root))?.config ?? null;
  } catch {
    return { derivation: { status: "invalid" }, hubFailure: null, publication: "not_applicable" };
  }
  const marker = await readMarker(input.root);
  if (convergenceOwnerHostOrigin(current, marker) === "operator")
    return { derivation: { status: "operator" }, hubFailure: null, publication: "not_applicable" };

  let chosen: ConvergenceOwnerHubCandidate | null = null;
  let hubFailure: KnowledgeConvergenceOwnerFailure | null = null;
  const currentHub = current?.coordination.mode === "hub" ? current.coordination.hub : null;
  for (const candidate of input.candidates) {
    // Unchanged coordinates were proven when they were written; the lease reports later failures.
    if (
      currentHub !== null &&
      marker?.unproven !== true &&
      canonicalJson(currentHub) === canonicalJson(candidate.hub)
    ) {
      chosen = candidate;
      break;
    }
    const failure = await input.probe(candidate.hub);
    if (failure === null) {
      chosen = candidate;
      break;
    }
    hubFailure ??= failure;
  }
  // A Hub configuration whose coordinates disappeared from every source stays as written: losing
  // a local service definition must not silently downgrade a coordinated host to standalone.
  if (chosen === null && currentHub !== null)
    return {
      derivation: { status: "unchanged", mode: "hub", source: marker?.source ?? "none" },
      hubFailure,
      publication: current?.publication === undefined ? "unavailable" : "configured",
    };

  // ADR-0470: Hub coordinates that exist but are refused or unreachable never fall back to
  // standalone, whose verdict owns unconditionally: another host may hold the Hub lease. The
  // most specific candidate is written unproven, so the lease reports `unverifiable` and this
  // host stays read-only until coordination works. Standalone is only for hosts without any.
  const unproven = chosen === null ? (input.candidates[0] ?? null) : null;
  const probeDue =
    chosen !== null &&
    current?.publication === undefined &&
    (marker?.publicationProbedAt === null ||
      marker?.publicationProbedAt === undefined ||
      input.now.getTime() - Date.parse(marker.publicationProbedAt) >=
        PUBLICATION_PROBE_INTERVAL_MS);
  const publication =
    chosen === null
      ? undefined
      : (current?.publication ??
        (probeDue ? ((await input.publication()) ?? undefined) : undefined));
  const desired = parseConvergenceOwnerHostConfig({
    schemaVersion: 1,
    hostId: current?.hostId ?? `hst_${(input.random ?? (() => randomBytes(16).toString("hex")))()}`,
    hostLabel: input.hostLabel,
    coordination:
      (chosen ?? unproven) === null
        ? { mode: "standalone" }
        : { mode: "hub", hub: (chosen ?? unproven)!.hub },
    ...(publication === undefined ? {} : { publication }),
  });
  const source = (chosen ?? unproven)?.source ?? "none";
  const unchanged =
    current !== null &&
    convergenceOwnerHostConfigHash(current) === convergenceOwnerHostConfigHash(desired);
  if (!unchanged)
    await writePrivateJsonFile(resolve(input.root, CONVERGENCE_OWNER_HOST_PATH), desired);
  const isUnproven = chosen === null && unproven !== null;
  if (!unchanged || probeDue || marker === null || (marker.unproven === true) !== isUnproven)
    await writePrivateJsonFile(resolve(input.root, CONVERGENCE_OWNER_HOST_DERIVATION_PATH), {
      schemaVersion: 1,
      configHash: convergenceOwnerHostConfigHash(desired),
      source,
      derivedAt: unchanged && marker !== null ? marker.derivedAt : input.now.toISOString(),
      publicationProbedAt: probeDue
        ? input.now.toISOString()
        : (marker?.publicationProbedAt ?? null),
      ...(isUnproven ? { unproven: true as const } : {}),
    } satisfies DerivationMarker);
  return {
    derivation: {
      status: unchanged ? "unchanged" : "derived",
      mode: desired.coordination.mode,
      source,
    },
    hubFailure: chosen === null ? hubFailure : null,
    publication:
      desired.coordination.mode !== "hub"
        ? "not_applicable"
        : desired.publication === undefined
          ? "unavailable"
          : "configured",
  };
}
