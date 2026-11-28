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
import {
  migrateDerivedKnowledgePublicationSettings,
  withOperatorPublicationChecks,
  type KnowledgePublicationSettings,
} from "./knowledge-publication-settings.js";
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
  /**
   * Whose credential the coordinates carry: absent for this project's own (or its Node's);
   * `foreign` for another repository's coordinates as written, usable only once a probe proves
   * them for this project; `absent` for another Hub paired with the path where this project's own
   * token belongs but does not exist yet.
   */
  credential?: "foreign" | "absent";
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
  /** The written coordinates name this project's own token, which does not exist yet. */
  credentialAbsent?: true;
  publication: "configured" | "unavailable" | "not_applicable";
}

/**
 * ADR-0596: the operator's `publication.checks` is left out, so adding an ignore list to a derived
 * configuration keeps it automatic; derivation carries the list over instead of dropping it.
 */
export function convergenceOwnerHostConfigHash(config: ConvergenceOwnerHostConfig): string {
  if (config.publication?.checks === undefined) return sha256(canonicalJson(config));
  const { checks: _checks, ...publication } = config.publication;
  return sha256(canonicalJson({ ...config, publication }));
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
  /**
   * The project's tracked `dataPolicy.hubSyncEnabled`. When false, only this project's own
   * credentials coordinate it through the Hub; a host without one maintains it standalone instead
   * of staying read-only behind another project's refused token (ADR-0654).
   */
  hubSyncEnabled?: boolean;
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
  // ADR-0654: a project that does not sync through the Hub is coordinated there only with its own
  // credential; without one, this host maintains it standalone rather than not at all.
  const hubSync = input.hubSyncEnabled !== false;
  const candidates = hubSync
    ? input.candidates
    : input.candidates.filter((candidate) => candidate.credential === undefined);
  const currentHub = current?.coordination.mode === "hub" ? current.coordination.hub : null;
  for (const candidate of candidates) {
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
  // ADR-0654: the unproven fallback is only ever this project's own credential or the path where
  // it belongs, never another repository's token that the Hub refused for this project.
  const unproven = chosen === null ? (candidates.find(ownCredential) ?? null) : null;
  // A proven Hub configuration whose coordinates disappeared from every source stays as written:
  // losing a local service definition must not silently downgrade a coordinated host to
  // standalone. Coordinates Lervo wrote unproven are replaced, so a borrowed token never stays.
  if (chosen === null && currentHub !== null && marker?.unproven !== true)
    return {
      derivation: { status: "unchanged", mode: "hub", source: marker?.source ?? "none" },
      hubFailure,
      publication: current?.publication === undefined ? "unavailable" : "configured",
    };

  // ADR-0470: Hub coordinates that exist but are refused or unreachable never fall back to
  // standalone, whose verdict owns unconditionally: another host may hold the Hub lease. The
  // most specific own candidate is written unproven, so the lease reports `unverifiable` and this
  // host stays read-only until coordination works. Standalone is only for hosts without any.
  // ADR-0473: a derived publication setting is probed again on the same interval, so a remote
  // whose default branch changed, or a base derived from a stale local ref, is corrected. A failed
  // probe keeps the current setting, and fixed default roots become the delegation scope.
  const probeDue =
    chosen !== null &&
    (marker?.publicationProbedAt === null ||
      marker?.publicationProbedAt === undefined ||
      input.now.getTime() - Date.parse(marker.publicationProbedAt) >=
        PUBLICATION_PROBE_INTERVAL_MS);
  const probed = probeDue ? await input.publication() : null;
  const kept =
    current?.publication === undefined
      ? undefined
      : migrateDerivedKnowledgePublicationSettings(current.publication);
  const derived = chosen === null ? undefined : (probed ?? kept);
  const publication =
    derived === undefined
      ? undefined
      : withOperatorPublicationChecks(derived, current?.publication);
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
    ...(chosen === null && unproven?.credential === "absent"
      ? { credentialAbsent: true as const }
      : {}),
    publication:
      desired.coordination.mode !== "hub"
        ? "not_applicable"
        : desired.publication === undefined
          ? "unavailable"
          : "configured",
  };
}

/** A candidate this project may be pinned to unproven: its own credential or that credential's path. */
function ownCredential(candidate: ConvergenceOwnerHubCandidate): boolean {
  return candidate.credential !== "foreign";
}
