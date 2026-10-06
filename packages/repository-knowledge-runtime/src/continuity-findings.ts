import type { ConvergenceContinuityPolicyReading } from "./continuity-policy-store.js";
import type { DelegationRenewalDecision } from "./delegation-continuity-decision.js";

const HOUR_MS = 60 * 60_000;
/** Without a policy, an expiring delegation is reported this long before it lapses. */
export const CONTINUITY_ATTENTION_LEAD_MS = 72 * HOUR_MS;
/** A peer that has not published for this long is reported as unreported. */
export const CONTINUITY_PEER_STALE_MS = 2 * HOUR_MS;

/**
 * `info` is reported by the doctor only. `attention` is an operating-attention item the system
 * expects to resolve itself or that names an operator fix. `owner_decision` needs the owner:
 * only a real authority or scope decision is ever raised this way.
 */
export type ContinuityFindingSeverity = "info" | "attention" | "owner_decision";

export type ContinuityFindingCode =
  | "delegation_missing"
  | "delegation_expiring"
  | "delegation_expired"
  | "delegation_revoked"
  | "delegation_invalid"
  | "delegation_outside_policy"
  | "delegation_continuation_failed"
  | "policy_absent"
  | "policy_invalid"
  | "policy_revoked"
  | "policy_horizon_near"
  | "owner_host_standalone"
  | "owner_host_hub_unusable"
  | "owner_host_invalid"
  | "lease_unverifiable"
  | "lease_contended"
  | "publication_unavailable"
  | "publication_failed"
  | "hub_unavailable"
  | "peer_delegation_missing"
  | "peer_delegation_expiring"
  | "peer_unreported"
  // Observed by the doctor and attention from local state rather than by the resident.
  | "continuity_unobserved"
  | "continuity_stale"
  | "resident_not_running"
  | "hook_runtime_stale"
  | "replica_diverged";

export interface ContinuityFinding {
  code: ContinuityFindingCode;
  severity: ContinuityFindingSeverity;
  /** A closed code or a host label, never a path, URL, or message. */
  detail: string | null;
}

export type ContinuityDelegationObservation =
  | { state: "missing" }
  | { state: "invalid" }
  | { state: "active" | "expired" | "revoked"; expiresAt: string };

/** The owner-host outcome of the last reconciliation, as the continuity state records it. */
export interface ContinuityOwnerHostObservation {
  state: "hub" | "standalone" | "operator" | "invalid";
  /** Why candidate Hub coordinates were not used; null when none failed. */
  hubFailureCode: string | null;
  publication: "configured" | "unavailable" | "not_applicable";
}

/** What a peer host last published, reduced to the facts findings need. */
export interface ContinuityPeerObservation {
  hostLabel: string;
  observedAt: string;
  delegationState: "active" | "expired" | "revoked" | "missing";
  delegationExpiresAt: string | null;
  policy: string;
}

export interface ContinuityFindingsInput {
  now: number;
  delegation: ContinuityDelegationObservation;
  policy: ConvergenceContinuityPolicyReading;
  renewal: DelegationRenewalDecision | null;
  continuationFailure: string | null;
  ownerHost: ContinuityOwnerHostObservation | null;
  /** The latest ADR-0466 verdict role and Hub cause from the fence. */
  verdict: { role: string; failureCode: string | null } | null;
  publicationStatus: string | null;
  hubFailure: string | null;
  peers: readonly ContinuityPeerObservation[];
}

function delegationFindings(input: ContinuityFindingsInput): ContinuityFinding[] {
  const active = input.policy.status === "loaded" && input.policy.policy.state === "active";
  const { delegation, renewal } = input;
  if (delegation.state === "invalid")
    return [{ code: "delegation_invalid", severity: "owner_decision", detail: null }];
  if (delegation.state === "revoked")
    return [{ code: "delegation_revoked", severity: "info", detail: null }];
  // A repository nobody delegated on any host is simply not enrolled; only a policy that should
  // seed it, or a peer that converges it, makes the gap worth attention.
  if (delegation.state === "missing")
    return [
      {
        code: "delegation_missing",
        severity: active
          ? "attention"
          : input.peers.some((peer) => peer.delegationState === "active")
            ? "owner_decision"
            : "info",
        detail: input.continuationFailure,
      },
    ];
  if (renewal?.kind === "outside_policy")
    return [
      { code: "delegation_outside_policy", severity: "owner_decision", detail: renewal.reason },
    ];
  const remaining = Date.parse(delegation.expiresAt) - input.now;
  const renewable = active && renewal !== null && ["current", "renew"].includes(renewal.kind);
  if (delegation.state === "expired")
    return [
      {
        code: "delegation_expired",
        severity: renewable ? "attention" : "owner_decision",
        detail: renewal?.kind ?? null,
      },
    ];
  if (remaining <= CONTINUITY_ATTENTION_LEAD_MS && !renewable)
    return [
      {
        code: "delegation_expiring",
        severity: "owner_decision",
        detail: renewal?.kind ?? "no_policy",
      },
    ];
  return [];
}

function policyFindings(input: ContinuityFindingsInput): ContinuityFinding[] {
  if (input.policy.status === "absent")
    return [{ code: "policy_absent", severity: "info", detail: null }];
  if (input.policy.status === "invalid")
    return [{ code: "policy_invalid", severity: "owner_decision", detail: null }];
  const { policy } = input.policy;
  if (policy.state === "revoked")
    return [{ code: "policy_revoked", severity: "info", detail: null }];
  return Date.parse(policy.horizonAt) - input.now <= CONTINUITY_ATTENTION_LEAD_MS
    ? [{ code: "policy_horizon_near", severity: "owner_decision", detail: null }]
    : [];
}

function hostFindings(input: ContinuityFindingsInput): ContinuityFinding[] {
  const findings: ContinuityFinding[] = [];
  const host = input.ownerHost;
  if (host?.state === "invalid")
    findings.push({ code: "owner_host_invalid", severity: "attention", detail: null });
  else if (host?.state === "standalone")
    findings.push(
      host.hubFailureCode === null
        ? { code: "owner_host_standalone", severity: "info", detail: null }
        : { code: "owner_host_hub_unusable", severity: "attention", detail: host.hubFailureCode },
    );
  if (host?.publication === "unavailable")
    findings.push({ code: "publication_unavailable", severity: "info", detail: null });
  if (input.verdict?.role === "unverifiable")
    findings.push({
      code: "lease_unverifiable",
      severity: "attention",
      detail: input.verdict.failureCode,
    });
  if (input.verdict?.role === "contended")
    findings.push({ code: "lease_contended", severity: "attention", detail: null });
  if (input.publicationStatus === "failed" || input.publicationStatus === "superseded")
    findings.push({
      code: "publication_failed",
      severity: "attention",
      detail: input.publicationStatus,
    });
  if (input.hubFailure !== null)
    findings.push({ code: "hub_unavailable", severity: "attention", detail: input.hubFailure });
  return findings;
}

/** Pure: what each peer host's last publication says about its own continuity. */
export function continuityPeerFindings(
  peers: readonly ContinuityPeerObservation[],
  now: number,
): ContinuityFinding[] {
  const input = { peers, now };
  const findings: ContinuityFinding[] = [];
  for (const peer of input.peers) {
    if (input.now - Date.parse(peer.observedAt) > CONTINUITY_PEER_STALE_MS)
      findings.push({ code: "peer_unreported", severity: "info", detail: peer.hostLabel });
    else if (peer.delegationState !== "active" || peer.delegationExpiresAt === null)
      findings.push({ code: "peer_delegation_missing", severity: "info", detail: peer.hostLabel });
    else if (Date.parse(peer.delegationExpiresAt) - input.now <= CONTINUITY_ATTENTION_LEAD_MS)
      findings.push({
        code: "peer_delegation_expiring",
        severity: peer.policy === "active" ? "info" : "attention",
        detail: peer.hostLabel,
      });
  }
  return findings;
}

/** Pure: every continuity gap this host can see, each with the narrowest needed severity. */
export function continuityFindings(input: ContinuityFindingsInput): ContinuityFinding[] {
  const findings = [
    ...delegationFindings(input),
    ...(input.continuationFailure !== null && input.delegation.state !== "missing"
      ? [
          {
            code: "delegation_continuation_failed" as const,
            severity: "attention" as const,
            detail: input.continuationFailure,
          },
        ]
      : []),
    ...policyFindings(input),
    ...hostFindings(input),
    ...continuityPeerFindings(input.peers, input.now),
  ];
  return findings.slice(0, 32);
}

/** A continuity projection older than this means no resident reconciles this checkout. */
export const CONTINUITY_STATE_STALE_MS = 2 * HOUR_MS;

/**
 * Pure: findings only a local reader can observe, added to the resident's persisted findings.
 * `expected` is true when this checkout should have a resident: it holds a delegation or the
 * host has an active continuity policy.
 */
export function localContinuityFindings(input: {
  now: number;
  expected: boolean;
  stateObservedAt: string | null;
  residentRunning: boolean | null;
  hookRuntime: "current" | "stale" | "unknown";
  replicaDiverged: boolean;
}): ContinuityFinding[] {
  const findings: ContinuityFinding[] = [];
  if (input.expected && input.stateObservedAt === null)
    findings.push({ code: "continuity_unobserved", severity: "attention", detail: null });
  else if (
    input.expected &&
    input.stateObservedAt !== null &&
    input.now - Date.parse(input.stateObservedAt) > CONTINUITY_STATE_STALE_MS
  )
    findings.push({ code: "continuity_stale", severity: "attention", detail: null });
  if (input.expected && input.residentRunning === false)
    findings.push({ code: "resident_not_running", severity: "attention", detail: null });
  if (input.hookRuntime === "stale")
    findings.push({ code: "hook_runtime_stale", severity: "attention", detail: null });
  if (input.replicaDiverged)
    findings.push({ code: "replica_diverged", severity: "attention", detail: null });
  return findings;
}
