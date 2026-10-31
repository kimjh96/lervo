import {
  isProviderCliAdmissionProjection,
  type ProviderCliAdmissionProjection,
} from "./provider-cli-observation.js";
import { canonicalJson } from "@lervo/event-contract";
import { projectIdSchema } from "@lervo/schemas";

import { syncContentHash } from "./hash.js";

/**
 * ADR-0469 cross-host continuity record. Every host that runs a knowledge resident for one
 * repository identity publishes one record through the Hub that also hosts the ADR-0466 owner
 * lease. Peers read it to seed a missing delegation at the same scope and to report fleet
 * coverage. A record carries the exchangeable delegation scope, which names roles, roots,
 * providers, suites, and ceilings, but never agent identities, Hub addresses, token paths,
 * hostnames, or document text.
 */
const HASH = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_ID = new RegExp(projectIdSchema.pattern, "u");
const HOST_LABEL = /^[a-z0-9][a-z0-9-]{0,31}$/u;
const CODE = /^[a-z][a-z0-9_]{0,63}$/u;

export const MAXIMUM_CONVERGENCE_HOST_RECORD_BYTES = 16 * 1024;
/** Hosts kept per repository identity; the stalest record is pruned past the limit. */
export const MAXIMUM_CONVERGENCE_HOST_RECORDS = 8;
export const MAXIMUM_CONVERGENCE_HOST_FINDINGS = 32;

export type KnowledgeConvergenceHostDelegationState = "active" | "expired" | "revoked";
export type KnowledgeConvergenceHostPolicyState =
  "active" | "absent" | "revoked" | "exhausted" | "invalid";

export interface KnowledgeConvergenceHostRecord {
  schemaVersion: 1;
  projectId: string;
  repositoryIdentityHash: string;
  hostHash: string;
  /** Operator-facing label such as `mac` or `wsl`; never a hostname or address. */
  hostLabel: string;
  observedAt: string;
  delegation: {
    state: KnowledgeConvergenceHostDelegationState;
    expiresAt: string;
    /** `syncContentHash(scope)`; an importer recomputes it before trusting the scope. */
    scopeHash: string;
    /** The exchangeable scope, validated again by every importing host. */
    scope: Record<string, unknown>;
  } | null;
  continuity: { policy: KnowledgeConvergenceHostPolicyState; horizonAt: string | null };
  owner: { role: string; reason: string } | null;
  publication: { configured: boolean; status: string | null };
  resident: { state: string; reason: string | null } | null;
  /** Closed continuity finding codes this host currently reports. */
  findings: string[];
  providerAdmission?: ProviderCliAdmissionProjection;
}

export type KnowledgeConvergenceHostPublishStatus = "created" | "updated" | "stale";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function code(value: unknown): value is string {
  return typeof value === "string" && CODE.test(value);
}

export function knowledgeConvergenceScopeHash(scope: unknown): string {
  return syncContentHash(scope);
}

function validDelegation(value: unknown): boolean {
  if (value === null) return true;
  if (!record(value) || !exactKeys(value, ["state", "expiresAt", "scopeHash", "scope"]))
    return false;
  return (
    (value.state === "active" || value.state === "expired" || value.state === "revoked") &&
    timestamp(value.expiresAt) &&
    typeof value.scopeHash === "string" &&
    HASH.test(value.scopeHash) &&
    record(value.scope) &&
    knowledgeConvergenceScopeHash(value.scope) === value.scopeHash
  );
}

/** Structural validation; the scope's own contract is checked by the importing host. */
export function isKnowledgeConvergenceHostRecord(
  value: unknown,
): value is KnowledgeConvergenceHostRecord {
  if (
    !record(value) ||
    !exactKeys(value, [
      ...(value.providerAdmission === undefined ? [] : ["providerAdmission"]),
      "schemaVersion",
      "projectId",
      "repositoryIdentityHash",
      "hostHash",
      "hostLabel",
      "observedAt",
      "delegation",
      "continuity",
      "owner",
      "publication",
      "resident",
      "findings",
    ])
  )
    return false;
  const { continuity, owner, publication, resident, findings } = value;
  return (
    (value.providerAdmission === undefined ||
      isProviderCliAdmissionProjection(value.providerAdmission)) &&
    value.schemaVersion === 1 &&
    typeof value.projectId === "string" &&
    PROJECT_ID.test(value.projectId) &&
    typeof value.repositoryIdentityHash === "string" &&
    HASH.test(value.repositoryIdentityHash) &&
    typeof value.hostHash === "string" &&
    HASH.test(value.hostHash) &&
    typeof value.hostLabel === "string" &&
    HOST_LABEL.test(value.hostLabel) &&
    timestamp(value.observedAt) &&
    validDelegation(value.delegation) &&
    record(continuity) &&
    exactKeys(continuity, ["policy", "horizonAt"]) &&
    ["active", "absent", "revoked", "exhausted", "invalid"].includes(String(continuity.policy)) &&
    (continuity.horizonAt === null || timestamp(continuity.horizonAt)) &&
    (owner === null ||
      (record(owner) &&
        exactKeys(owner, ["role", "reason"]) &&
        code(owner.role) &&
        code(owner.reason))) &&
    record(publication) &&
    exactKeys(publication, ["configured", "status"]) &&
    typeof publication.configured === "boolean" &&
    (publication.status === null || code(publication.status)) &&
    (resident === null ||
      (record(resident) &&
        exactKeys(resident, ["state", "reason"]) &&
        code(resident.state) &&
        (resident.reason === null ||
          (typeof resident.reason === "string" &&
            /^[a-z][a-z0-9_:.-]{0,95}$/u.test(resident.reason))))) &&
    Array.isArray(findings) &&
    findings.length <= MAXIMUM_CONVERGENCE_HOST_FINDINGS &&
    findings.every(code) &&
    Buffer.byteLength(canonicalJson(value)) <= MAXIMUM_CONVERGENCE_HOST_RECORD_BYTES
  );
}

/**
 * The Hub's pure merge for one publish: a host replaces only its own record, and an older
 * observation never overwrites a newer one.
 */
export function mergeKnowledgeConvergenceHostRecord(input: {
  current: KnowledgeConvergenceHostRecord | null;
  incoming: KnowledgeConvergenceHostRecord;
}): { next: KnowledgeConvergenceHostRecord; status: KnowledgeConvergenceHostPublishStatus } {
  const { current, incoming } = input;
  if (current === null) return { next: incoming, status: "created" };
  if (Date.parse(incoming.observedAt) < Date.parse(current.observedAt))
    return { next: current, status: "stale" };
  return { next: incoming, status: "updated" };
}
