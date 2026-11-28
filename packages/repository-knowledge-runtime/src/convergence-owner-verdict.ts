import type {
  KnowledgeConvergenceOwnerDecision,
  KnowledgeConvergenceOwnerFailure,
  KnowledgeConvergenceOwnerFailureCode,
} from "@lervo/sync-contract";

/** ADR-0466 lease timing. Renewal is a bounded heartbeat, never a tight poll. */
export const CONVERGENCE_OWNER_LEASE_TTL_MS = 30 * 60_000;
export const CONVERGENCE_OWNER_RENEW_AFTER_MS = CONVERGENCE_OWNER_LEASE_TTL_MS / 3;
/** Local validity ends this long before the Hub-clock expiry, absorbing request latency. */
export const CONVERGENCE_OWNER_SAFETY_MARGIN_MS = 60_000;
/** A waiting host re-checks this long after the holder's Hub-clock expiry. */
export const CONVERGENCE_OWNER_WAKE_GRACE_MS = 5_000;
/** After a manual release this host does not reclaim before a peer had one full lease to claim. */
export const CONVERGENCE_OWNER_YIELD_MS = CONVERGENCE_OWNER_LEASE_TTL_MS;

/**
 * - `owner`: this host may converge and commit knowledge outputs until `validUntil`.
 * - `waiting_owner`: another host holds a live lease; this host stays read-only.
 * - `unverifiable`: ownership cannot be proven (Hub unreachable without a live local lease,
 *   invalid host configuration, or missing transport); this host stays read-only with attention.
 *   A failed Hub request names its cause in `failureCode` and `httpStatus`.
 * - `contended`: a standalone host saw another host's fresh knowledge commit; read-only with
 *   attention, because two unconfigured hosts are converging one repository.
 * - `ineligible`: this host does not contend for the lease: it has no usable delegation
 *   (`knowledge_authority_unavailable`), or no provider the delegation allows was admitted here
 *   within the last hour (`provider_not_admitted`, with `wakeAt` when that observation lapses).
 * - `yielding`: an operator released this host's lease; it does not reclaim until `yieldUntil`.
 */
export type ConvergenceOwnerRole =
  "owner" | "waiting_owner" | "unverifiable" | "contended" | "ineligible" | "yielding";

export type ConvergenceOwnerReason =
  | "lease_granted"
  | "lease_renewed"
  | "lease_held"
  | "hub_unavailable_within_lease"
  | "standalone_owner"
  | "convergence_owner_elsewhere"
  | "convergence_owner_unverifiable"
  | "convergence_owner_host_invalid"
  | "convergence_owner_transport_missing"
  | "convergence_owner_contended"
  | "knowledge_authority_unavailable"
  | "provider_not_admitted"
  | "convergence_owner_released";

export interface ConvergenceOwnerHolder {
  hostHash: string;
  label: string | null;
  generation: number | null;
  /** Hub-clock expiry of the holder's lease, when known. */
  expiresAt: string | null;
}

export interface ConvergenceOwnerVerdict {
  role: ConvergenceOwnerRole;
  reason: ConvergenceOwnerReason;
  mode: "hub" | "standalone";
  hostHash: string | null;
  hostLabel: string | null;
  holder: ConvergenceOwnerHolder | null;
  /** Local instant until which this host may act as owner; null unless `owner`. */
  validUntil: string | null;
  /**
   * Local instant at which a non-owner should look again: when a lease expiry is known, or when an
   * `ineligible` host's provider observation lapses.
   */
  wakeAt: string | null;
  /** Local instant at which this host last obtained a grant or renewal from the Hub. */
  grantedAt: string | null;
  yieldUntil: string | null;
  observedAt: string;
  /**
   * Why the last Hub lease request proved nothing; set only by a failed request. Absent in fences
   * written before the field existed, which read as no recorded cause.
   */
  failureCode?: KnowledgeConvergenceOwnerFailureCode | null;
  /** The Hub's HTTP status for `failureCode`, when it answered with one. */
  httpStatus?: number | null;
}

const iso = (milliseconds: number) => new Date(milliseconds).toISOString();

/**
 * Converts one Hub answer into local time. The remaining lease lifetime is measured on the Hub
 * clock and applied from the local instant the request started, so clock skew between hosts
 * cannot extend local validity past the Hub expiry.
 */
export function verdictFromHubDecision(input: {
  decision: KnowledgeConvergenceOwnerDecision;
  requestStartedAt: number;
  observedAt: number;
  host: { hostHash: string; hostLabel: string };
}): ConvergenceOwnerVerdict {
  const { decision, requestStartedAt } = input;
  const base = {
    mode: "hub" as const,
    hostHash: input.host.hostHash,
    hostLabel: input.host.hostLabel,
    yieldUntil: null,
    observedAt: iso(input.observedAt),
  };
  const lease = decision.lease;
  const remaining = lease === null ? 0 : Date.parse(lease.expiresAt) - Date.parse(decision.hubTime);
  const holder: ConvergenceOwnerHolder | null =
    lease === null
      ? null
      : {
          hostHash: lease.holderHostHash,
          label: lease.holderLabel,
          generation: lease.generation,
          expiresAt: lease.expiresAt,
        };
  if (
    (decision.status === "granted" || decision.status === "renewed") &&
    lease !== null &&
    lease.holderHostHash === input.host.hostHash &&
    remaining > CONVERGENCE_OWNER_SAFETY_MARGIN_MS
  )
    return {
      ...base,
      role: "owner",
      reason: decision.status === "granted" ? "lease_granted" : "lease_renewed",
      holder,
      validUntil: iso(requestStartedAt + remaining - CONVERGENCE_OWNER_SAFETY_MARGIN_MS),
      wakeAt: null,
      grantedAt: iso(requestStartedAt),
    };
  if (decision.status === "held_elsewhere" && lease !== null)
    return {
      ...base,
      role: "waiting_owner",
      reason: "convergence_owner_elsewhere",
      holder,
      validUntil: null,
      // ADR-0602: a present holder's lease does not expire by time; its departure is pushed.
      wakeAt:
        decision.holderPresent === true
          ? null
          : iso(requestStartedAt + Math.max(0, remaining) + CONVERGENCE_OWNER_WAKE_GRACE_MS),
      grantedAt: null,
    };
  return {
    ...base,
    role: "unverifiable",
    reason: "convergence_owner_unverifiable",
    holder,
    validUntil: null,
    wakeAt: null,
    grantedAt: null,
  };
}

/**
 * Without a Hub answer, only a lease this host already proved stays usable, and only until its
 * locally computed validity ends. Anything else is unverifiable, never a silent standalone owner.
 */
export function verdictWithoutHub(input: {
  previous: ConvergenceOwnerVerdict | null;
  now: number;
  host: { hostHash: string; hostLabel: string };
  /** The failed request's cause; null when no request was possible, such as a missing transport. */
  failure: KnowledgeConvergenceOwnerFailure | null;
}): ConvergenceOwnerVerdict {
  const { previous, now } = input;
  const cause = {
    failureCode: input.failure?.failureCode ?? null,
    httpStatus: input.failure?.httpStatus ?? null,
  };
  if (
    previous?.role === "owner" &&
    previous.mode === "hub" &&
    previous.hostHash === input.host.hostHash &&
    previous.validUntil !== null &&
    Date.parse(previous.validUntil) > now
  )
    return {
      ...previous,
      reason: "hub_unavailable_within_lease",
      observedAt: iso(now),
      ...cause,
    };
  return {
    role: "unverifiable",
    reason: "convergence_owner_unverifiable",
    mode: "hub",
    hostHash: input.host.hostHash,
    hostLabel: input.host.hostLabel,
    holder: previous?.holder ?? null,
    validUntil: null,
    wakeAt: null,
    grantedAt: null,
    yieldUntil: null,
    observedAt: iso(now),
    ...cause,
  };
}

/** The verdict without a Hub failure cause, for a held lease that needed no request. */
export function withoutHubFailure(verdict: ConvergenceOwnerVerdict): ConvergenceOwnerVerdict {
  const { failureCode: _failureCode, httpStatus: _httpStatus, ...rest } = verdict;
  return rest;
}

/** A live, recently granted lease needs no Hub round trip until its renewal point. */
export function heldLeaseCurrent(input: {
  previous: ConvergenceOwnerVerdict | null;
  now: number;
  hostHash: string;
}): boolean {
  const { previous, now } = input;
  return (
    previous?.role === "owner" &&
    previous.mode === "hub" &&
    previous.hostHash === input.hostHash &&
    previous.grantedAt !== null &&
    previous.validUntil !== null &&
    now - Date.parse(previous.grantedAt) < CONVERGENCE_OWNER_RENEW_AFTER_MS &&
    Date.parse(previous.validUntil) > now
  );
}

/**
 * A standalone host owns unless another host's knowledge commit is newer than one lease lifetime.
 * Two unconfigured hosts therefore surface contention instead of silently double-owning.
 */
export function standaloneVerdict(input: {
  foreignCommits: readonly { hostHash: string; committedAt: number }[];
  now: number;
  host: { hostHash: string; hostLabel: string };
}): ConvergenceOwnerVerdict {
  const fresh = input.foreignCommits
    .filter((commit) => input.now - commit.committedAt < CONVERGENCE_OWNER_LEASE_TTL_MS)
    .sort((left, right) => right.committedAt - left.committedAt)[0];
  const base = {
    mode: "standalone" as const,
    hostHash: input.host.hostHash,
    hostLabel: input.host.hostLabel,
    grantedAt: null,
    yieldUntil: null,
    observedAt: iso(input.now),
  };
  if (fresh !== undefined)
    return {
      ...base,
      role: "contended",
      reason: "convergence_owner_contended",
      holder: { hostHash: fresh.hostHash, label: null, generation: null, expiresAt: null },
      validUntil: null,
      wakeAt: iso(fresh.committedAt + CONVERGENCE_OWNER_LEASE_TTL_MS),
    };
  return {
    ...base,
    role: "owner",
    reason: "standalone_owner",
    holder: {
      hostHash: input.host.hostHash,
      label: input.host.hostLabel,
      generation: null,
      expiresAt: null,
    },
    validUntil: iso(input.now + CONVERGENCE_OWNER_LEASE_TTL_MS),
    wakeAt: null,
  };
}

/** The holder identity whose change is recorded as `knowledge.convergence.owner.changed`. */
export function ownerHolderKey(verdict: ConvergenceOwnerVerdict | null): string | null {
  if (verdict === null || verdict.holder === null) return null;
  if (verdict.role !== "owner" && verdict.role !== "waiting_owner" && verdict.role !== "contended")
    return null;
  return `${verdict.holder.hostHash}#${verdict.holder.generation ?? "standalone"}`;
}
