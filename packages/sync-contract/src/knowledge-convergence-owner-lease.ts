import { projectIdSchema } from "@lervo/schemas";

/**
 * ADR-0466 cross-host knowledge convergence owner lease. One lease exists per Hub destination,
 * project, and repository identity. The Hub clock is authoritative for expiry, so hosts with
 * skewed clocks never both believe they hold a fresh lease.
 */
const HASH = /^sha256:[a-f0-9]{64}$/u;
const PROJECT_ID = new RegExp(projectIdSchema.pattern, "u");
const HOST_LABEL = /^[a-z0-9][a-z0-9-]{0,31}$/u;

export const KNOWLEDGE_CONVERGENCE_OWNER_LEASE_MINIMUM_TTL_MS = 60_000;
export const KNOWLEDGE_CONVERGENCE_OWNER_LEASE_MAXIMUM_TTL_MS = 60 * 60_000;

export interface KnowledgeConvergenceOwnerLease {
  schemaVersion: 1;
  projectId: string;
  repositoryIdentityHash: string;
  holderHostHash: string;
  /** Operator-chosen host label such as `mac` or `wsl`; never a hostname or address. */
  holderLabel: string;
  /** Increments whenever the holder changes or a released or expired lease is granted again. */
  generation: number;
  acquiredAt: string;
  renewedAt: string;
  expiresAt: string;
  releasedAt: string | null;
}

export interface KnowledgeConvergenceOwnerClaim {
  schemaVersion: 1;
  projectId: string;
  repositoryIdentityHash: string;
  hostHash: string;
  hostLabel: string;
  ttlMs: number;
}

export interface KnowledgeConvergenceOwnerRelease {
  schemaVersion: 1;
  projectId: string;
  repositoryIdentityHash: string;
  hostHash: string;
  generation: number;
}

export type KnowledgeConvergenceOwnerMutation =
  | { operation: "claim"; request: KnowledgeConvergenceOwnerClaim }
  | { operation: "release"; request: KnowledgeConvergenceOwnerRelease };

/** How the lease this claim replaced ended; `null` when no lease existed. */
export interface KnowledgeConvergenceOwnerPredecessor {
  holderHostHash: string;
  generation: number;
  ended: "expired" | "released";
}

/**
 * ADR-0602: whether the lease holder holds its Hub `knowledge` wait right now. While it does, the
 * Hub keeps its lease live and pushes a change when the holder leaves, so a waiting host arms no
 * expiry deadline; absent from Hubs older than ADR-0602, whose leases still expire by time.
 */
export interface KnowledgeConvergenceOwnerHolderPresence {
  holderPresent?: boolean;
}

export type KnowledgeConvergenceOwnerDecision = KnowledgeConvergenceOwnerHolderPresence &
  (
    | {
        status: "granted";
        lease: KnowledgeConvergenceOwnerLease;
        predecessor: KnowledgeConvergenceOwnerPredecessor | null;
        hubTime: string;
      }
    | { status: "renewed" | "released"; lease: KnowledgeConvergenceOwnerLease; hubTime: string }
    | { status: "held_elsewhere"; lease: KnowledgeConvergenceOwnerLease; hubTime: string }
    | { status: "not_holder"; lease: KnowledgeConvergenceOwnerLease | null; hubTime: string }
  );

/** A read names no host, so it reports only whether a live lease exists. */
export type KnowledgeConvergenceOwnerReading = KnowledgeConvergenceOwnerHolderPresence &
  (
    | { status: "held"; lease: KnowledgeConvergenceOwnerLease; hubTime: string }
    | { status: "vacant"; lease: KnowledgeConvergenceOwnerLease | null; hubTime: string }
  );

function timestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && [...keys].sort().every((key, i) => actual[i] === key);
}

function coordinates(value: Record<string, unknown>): boolean {
  return (
    value.schemaVersion === 1 &&
    typeof value.projectId === "string" &&
    PROJECT_ID.test(value.projectId) &&
    typeof value.repositoryIdentityHash === "string" &&
    HASH.test(value.repositoryIdentityHash) &&
    typeof value.hostHash === "string" &&
    HASH.test(value.hostHash)
  );
}

export function isKnowledgeConvergenceOwnerMutation(
  value: unknown,
): value is KnowledgeConvergenceOwnerMutation {
  if (!record(value) || !exactKeys(value, ["operation", "request"]) || !record(value.request))
    return false;
  const request = value.request;
  if (value.operation === "claim")
    return (
      exactKeys(request, [
        "schemaVersion",
        "projectId",
        "repositoryIdentityHash",
        "hostHash",
        "hostLabel",
        "ttlMs",
      ]) &&
      coordinates(request) &&
      typeof request.hostLabel === "string" &&
      HOST_LABEL.test(request.hostLabel) &&
      Number.isSafeInteger(request.ttlMs) &&
      (request.ttlMs as number) >= KNOWLEDGE_CONVERGENCE_OWNER_LEASE_MINIMUM_TTL_MS &&
      (request.ttlMs as number) <= KNOWLEDGE_CONVERGENCE_OWNER_LEASE_MAXIMUM_TTL_MS
    );
  if (value.operation === "release")
    return (
      exactKeys(request, [
        "schemaVersion",
        "projectId",
        "repositoryIdentityHash",
        "hostHash",
        "generation",
      ]) &&
      coordinates(request) &&
      Number.isSafeInteger(request.generation) &&
      (request.generation as number) >= 1
    );
  return false;
}

export function isKnowledgeConvergenceOwnerLease(
  value: unknown,
): value is KnowledgeConvergenceOwnerLease {
  return (
    record(value) &&
    exactKeys(value, [
      "schemaVersion",
      "projectId",
      "repositoryIdentityHash",
      "holderHostHash",
      "holderLabel",
      "generation",
      "acquiredAt",
      "renewedAt",
      "expiresAt",
      "releasedAt",
    ]) &&
    value.schemaVersion === 1 &&
    typeof value.projectId === "string" &&
    PROJECT_ID.test(value.projectId) &&
    typeof value.repositoryIdentityHash === "string" &&
    HASH.test(value.repositoryIdentityHash) &&
    typeof value.holderHostHash === "string" &&
    HASH.test(value.holderHostHash) &&
    typeof value.holderLabel === "string" &&
    HOST_LABEL.test(value.holderLabel) &&
    Number.isSafeInteger(value.generation) &&
    (value.generation as number) >= 1 &&
    timestamp(value.acquiredAt) &&
    timestamp(value.renewedAt) &&
    timestamp(value.expiresAt) &&
    (value.releasedAt === null || timestamp(value.releasedAt))
  );
}

export function isKnowledgeConvergenceOwnerDecision(
  value: unknown,
): value is KnowledgeConvergenceOwnerDecision {
  if (!record(value) || !timestamp(value.hubTime)) return false;
  const lease = value.lease === null || isKnowledgeConvergenceOwnerLease(value.lease);
  switch (value.status) {
    case "granted":
      return (
        value.lease !== null &&
        lease &&
        (value.predecessor === null ||
          (record(value.predecessor) &&
            typeof value.predecessor.holderHostHash === "string" &&
            HASH.test(value.predecessor.holderHostHash) &&
            Number.isSafeInteger(value.predecessor.generation) &&
            (value.predecessor.ended === "expired" || value.predecessor.ended === "released")))
      );
    case "renewed":
    case "released":
    case "held_elsewhere":
      return value.lease !== null && lease;
    case "not_holder":
      return lease;
    default:
      return false;
  }
}

/** A lease that is neither released nor past its Hub-clock expiry. */
export function knowledgeConvergenceOwnerLeaseLive(
  lease: KnowledgeConvergenceOwnerLease | null,
  at: string,
): boolean {
  return (
    lease !== null && lease.releasedAt === null && Date.parse(lease.expiresAt) > Date.parse(at)
  );
}

/**
 * The single authoritative lease transition. A claim by the live holder renews; a claim against a
 * vacant, released, or expired lease grants the next generation; any other claim is refused with
 * the live holder. Only the holder of the exact generation can release.
 */
export function decideKnowledgeConvergenceOwnerMutation(input: {
  current: KnowledgeConvergenceOwnerLease | null;
  mutation: KnowledgeConvergenceOwnerMutation;
  acceptedAt: string;
}): { next: KnowledgeConvergenceOwnerLease | null; decision: KnowledgeConvergenceOwnerDecision } {
  const { current, mutation, acceptedAt } = input;
  if (!timestamp(acceptedAt)) throw new Error("The convergence owner acceptance time is invalid.");
  const live = knowledgeConvergenceOwnerLeaseLive(current, acceptedAt);
  if (mutation.operation === "release") {
    const request = mutation.request;
    if (
      current === null ||
      !live ||
      current.holderHostHash !== request.hostHash ||
      current.generation !== request.generation
    )
      return {
        next: current,
        decision: { status: "not_holder", lease: current, hubTime: acceptedAt },
      };
    const released = { ...current, releasedAt: acceptedAt, expiresAt: acceptedAt };
    return {
      next: released,
      decision: { status: "released", lease: released, hubTime: acceptedAt },
    };
  }
  const request = mutation.request;
  const expiresAt = new Date(Date.parse(acceptedAt) + request.ttlMs).toISOString();
  if (live && current !== null && current.holderHostHash !== request.hostHash)
    return {
      next: current,
      decision: { status: "held_elsewhere", lease: current, hubTime: acceptedAt },
    };
  if (live && current !== null) {
    const renewed = {
      ...current,
      holderLabel: request.hostLabel,
      renewedAt: acceptedAt,
      expiresAt,
    };
    return { next: renewed, decision: { status: "renewed", lease: renewed, hubTime: acceptedAt } };
  }
  const granted: KnowledgeConvergenceOwnerLease = {
    schemaVersion: 1,
    projectId: request.projectId,
    repositoryIdentityHash: request.repositoryIdentityHash,
    holderHostHash: request.hostHash,
    holderLabel: request.hostLabel,
    generation: (current?.generation ?? 0) + 1,
    acquiredAt: acceptedAt,
    renewedAt: acceptedAt,
    expiresAt,
    releasedAt: null,
  };
  return {
    next: granted,
    decision: {
      status: "granted",
      lease: granted,
      predecessor:
        current === null
          ? null
          : {
              holderHostHash: current.holderHostHash,
              generation: current.generation,
              ended: current.releasedAt === null ? "expired" : "released",
            },
      hubTime: acceptedAt,
    },
  };
}

export function isKnowledgeConvergenceOwnerReading(
  value: unknown,
): value is KnowledgeConvergenceOwnerReading {
  if (!record(value) || !timestamp(value.hubTime)) return false;
  if (value.status === "held") return isKnowledgeConvergenceOwnerLease(value.lease);
  return (
    value.status === "vacant" &&
    (value.lease === null || isKnowledgeConvergenceOwnerLease(value.lease))
  );
}

/** The read view: the live lease, or `vacant` with the last ended lease for context. */
export function readKnowledgeConvergenceOwnerLease(input: {
  current: KnowledgeConvergenceOwnerLease | null;
  acceptedAt: string;
}): KnowledgeConvergenceOwnerReading {
  return input.current !== null &&
    knowledgeConvergenceOwnerLeaseLive(input.current, input.acceptedAt)
    ? { status: "held", lease: input.current, hubTime: input.acceptedAt }
    : { status: "vacant", lease: input.current, hubTime: input.acceptedAt };
}
