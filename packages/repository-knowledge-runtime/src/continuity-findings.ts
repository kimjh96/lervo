import type { ConvergenceContinuityPolicyReading } from "./continuity-policy-store.js";
import type { DelegationRenewalDecision } from "./delegation-continuity-decision.js";
import type { ResidentHostObservation } from "./resident-host-observation.js";
import type { ResidentCycleState } from "./resident-cycle-state.js";

const HOUR_MS = 60 * 60_000;
/** Without a policy, an expiring delegation is reported this long before it lapses. */
export const CONTINUITY_ATTENTION_LEAD_MS = 72 * HOUR_MS;
/** A peer that has not published for this long is reported as unreported. */
export const CONTINUITY_PEER_STALE_MS = 2 * HOUR_MS;

/**
 * `info` is reported by the doctor only. `attention` is an operating-attention item the system
 * expects to resolve itself or that names an operator fix. `lervo_debt` (ADR-0561) is continuity
 * Lervo could not restore within the last installed policy bounds; it is shown with its age and
 * reason and never waits for the owner. Stored `owner_decision` findings read as `lervo_debt`.
 */
export type ContinuityFindingSeverity = "info" | "attention" | "lervo_debt";

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
  | "definition_exchange_unavailable"
  | "peer_delegation_missing"
  | "peer_delegation_expiring"
  | "peer_unreported"
  // Observed by the doctor and attention from local state rather than by the resident.
  | "continuity_unobserved"
  | "continuity_stale"
  | "resident_not_running"
  | "resident_cycle_failed"
  | "hook_runtime_unavailable"
  | "replica_diverged"
  // ADR-0470 resident admission, observed from resident health and the host resident status.
  | "event_schema_outdated"
  | "continuity_pending"
  | "host_resident_scan_stalled"
  // ADR-0530: the owner's resident stopped convergence for a closed cause the status names.
  | "convergence_attention"
  | "provider_cli_detected"
  | "provider_cli_admitted"
  | "provider_cli_rejected"
  | "provider_detection_failed"
  | "provider_not_admitted";

export interface ContinuityFinding {
  actor?: "provider admission";
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
  /** ADR-0477: why exchanging delegation-bound definitions failed, if it did. */
  definitionExchangeFailure?: string | null;
  peers: readonly ContinuityPeerObservation[];
}

function delegationFindings(input: ContinuityFindingsInput): ContinuityFinding[] {
  const active = input.policy.status === "loaded" && input.policy.policy.state === "active";
  const { delegation, renewal } = input;
  if (delegation.state === "invalid")
    return [{ code: "delegation_invalid", severity: "lervo_debt", detail: null }];
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
            ? "lervo_debt"
            : "info",
        detail: input.continuationFailure,
      },
    ];
  if (renewal?.kind === "outside_policy")
    return [{ code: "delegation_outside_policy", severity: "lervo_debt", detail: renewal.reason }];
  const remaining = Date.parse(delegation.expiresAt) - input.now;
  const renewable = active && renewal !== null && ["current", "renew"].includes(renewal.kind);
  if (delegation.state === "expired")
    return [
      {
        code: "delegation_expired",
        severity: renewable ? "attention" : "lervo_debt",
        detail: renewal?.kind ?? null,
      },
    ];
  if (remaining <= CONTINUITY_ATTENTION_LEAD_MS && !renewable)
    return [
      {
        code: "delegation_expiring",
        severity: "lervo_debt",
        detail: renewal?.kind ?? "no_policy",
      },
    ];
  return [];
}

function policyFindings(input: ContinuityFindingsInput): ContinuityFinding[] {
  if (input.policy.status === "absent")
    return [{ code: "policy_absent", severity: "info", detail: null }];
  if (input.policy.status === "invalid")
    return [{ code: "policy_invalid", severity: "lervo_debt", detail: null }];
  const { policy } = input.policy;
  if (policy.state === "revoked")
    return [{ code: "policy_revoked", severity: "info", detail: null }];
  // ADR-0561: the resident rolls the horizon forward itself; a near horizon means it has not yet.
  return Date.parse(policy.horizonAt) - input.now <= CONTINUITY_ATTENTION_LEAD_MS
    ? [{ code: "policy_horizon_near", severity: "attention", detail: null }]
    : [];
}

function hostFindings(input: ContinuityFindingsInput): ContinuityFinding[] {
  const findings: ContinuityFinding[] = [];
  const host = input.ownerHost;
  if (host?.state === "invalid")
    findings.push({ code: "owner_host_invalid", severity: "attention", detail: null });
  // ADR-0470: Hub coordinates written unproven keep this host read-only until they work.
  else if (host?.state === "hub" && host.hubFailureCode !== null)
    findings.push({
      code: "owner_host_hub_unusable",
      severity: "attention",
      detail: host.hubFailureCode,
    });
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
  else if ((input.definitionExchangeFailure ?? null) !== null)
    findings.push({
      code: "definition_exchange_unavailable",
      severity: "attention",
      detail: input.definitionExchangeFailure!,
    });
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

/** The closed detail naming which host should run an unobserved checkout's resident. */
function residentHostDetail(host: ResidentHostObservation | null): string | null {
  switch (host?.kind) {
    case "node":
      return "node_served";
    case "host_absent":
      return "host_resident_absent";
    case "host_unlisted":
      return "host_resident_unlisted";
    default:
      return null;
  }
}

/**
 * Pure: findings only a local reader can observe, added to the resident's persisted findings.
 * `expected` is true when this checkout should have a resident: it holds a delegation or the
 * host has an active continuity policy. A held resident (ADR-0470) reports its cause instead of
 * an absent resident, and a checkout the host resident serves but has not reconciled yet is only
 * pending, so the advice never asks for a resident that already runs.
 */
export function localContinuityFindings(input: {
  now: number;
  expected: boolean;
  stateObservedAt: string | null;
  residentRunning: boolean | null;
  hookRuntime: "current" | "unavailable" | "unknown";
  replicaDiverged: boolean;
  /** The reason a degraded resident heartbeat reports, such as `event_schema_outdated`. */
  residentHold?: string | null;
  residentHost?: ResidentHostObservation | null;
  /** Whether this host owns convergence, so a degraded resident is a convergence stop. */
  owner?: boolean;
  residentCycle?: Pick<ResidentCycleState, "lastResult" | "lastFailure"> | null;
}): ContinuityFinding[] {
  const findings: ContinuityFinding[] = [];
  if (input.residentCycle?.lastResult === "failed")
    findings.push({
      code: "resident_cycle_failed",
      severity: "attention",
      detail: input.residentCycle.lastFailure?.code ?? "unclassified_failure",
    });
  const host = input.residentHost ?? null;
  const held = input.residentHold === "event_schema_outdated" || host?.kind === "host_held";
  const detail = residentHostDetail(host);
  if (held)
    findings.push({
      code: "event_schema_outdated",
      severity: "attention",
      detail: host?.kind === "host_held" ? host.detail : null,
    });
  else if (input.expected && input.stateObservedAt === null)
    findings.push(
      host?.kind === "host_serving"
        ? { code: "continuity_pending", severity: "info", detail: null }
        : { code: "continuity_unobserved", severity: "attention", detail },
    );
  else if (
    input.expected &&
    input.stateObservedAt !== null &&
    input.now - Date.parse(input.stateObservedAt) > CONTINUITY_STATE_STALE_MS
  )
    findings.push({ code: "continuity_stale", severity: "attention", detail });
  if (!held && input.expected && input.residentRunning === false && host?.kind !== "host_serving")
    findings.push({ code: "resident_not_running", severity: "attention", detail });
  if (host?.kind === "host_stalled")
    findings.push({ code: "host_resident_scan_stalled", severity: "attention", detail: null });
  if (input.hookRuntime === "unavailable")
    findings.push({ code: "hook_runtime_unavailable", severity: "attention", detail: null });
  if (input.replicaDiverged)
    findings.push({ code: "replica_diverged", severity: "attention", detail: null });
  // A stop that only the owner's status names would otherwise stay silent until someone asks.
  if (!held && input.owner === true && input.residentHold)
    findings.push({
      code: "convergence_attention",
      severity: "attention",
      detail: input.residentHold,
    });
  return findings;
}
