import { canonicalJson, sha256 } from "@lervo/repository-knowledge";

import type { ConvergenceOwnerVerdict } from "./convergence-owner-verdict.js";
import type { KnowledgeResidentState } from "./resident-health.js";
import { earliestMoment, type ConvergenceSourceFingerprint } from "./source-fingerprint.js";

/** The owner heartbeat; renewal itself happens only once a third of the lease has elapsed. */
export const RESIDENT_OWNER_HEARTBEAT_MILLISECONDS = 10 * 60_000;

/**
 * Folds the ownership role into the ADR-0461 change fence. A host that gains or loses ownership
 * therefore runs a full cycle even when no source byte changed. A non-owner ignores due
 * deliveries, which only the owner may claim, and wakes when the holder's lease can expire.
 */
export function ownershipFingerprint(
  observed: ConvergenceSourceFingerprint,
  verdict: ConvergenceOwnerVerdict | null,
): ConvergenceSourceFingerprint {
  if (verdict === null) return observed;
  const owner = verdict.role === "owner";
  const wakeAt = verdict.wakeAt === null ? null : Date.parse(verdict.wakeAt);
  return {
    ...observed,
    fingerprint: sha256(
      canonicalJson({
        source: observed.fingerprint,
        role: verdict.role,
        holder: verdict.holder?.hostHash ?? null,
        generation: verdict.holder?.generation ?? null,
      }),
    ),
    // ADR-0595: local time-based stages run on every host, so a non-owner wakes for them too.
    earliestAvailableAt: owner
      ? observed.earliestAvailableAt
      : earliestMoment(wakeAt, observed.localWakeAt ?? null),
  };
}

/**
 * ADR-0602: folds the Hub's `knowledge` change token into the change fence. Hub coordination state
 * (owner-rule candidates, host records, definitions, the lease holder) has no local signal, so a
 * new token is what makes the next cycle run in full instead of skipping. Without a Hub, or while
 * the wait is down, the fingerprint is unchanged; a reconnection yields a new token.
 */
export function hubTokenFingerprint(
  observed: ConvergenceSourceFingerprint,
  token: string | null,
): ConvergenceSourceFingerprint {
  if (token === null) return observed;
  return {
    ...observed,
    fingerprint: sha256(canonicalJson({ source: observed.fingerprint, hub: token })),
  };
}

/**
 * ADR-0485: folds the evaluation contract into the change fence, so a newly deployed runtime runs a
 * full cycle at once instead of skipping on a fingerprint the previous runtime recorded.
 */
export function evaluationFingerprint(
  observed: ConvergenceSourceFingerprint,
  evaluationContract: string,
): ConvergenceSourceFingerprint {
  return {
    ...observed,
    fingerprint: sha256(canonicalJson({ source: observed.fingerprint, evaluationContract })),
  };
}

/**
 * Resident health for a non-owner. Waiting for another holder is healthy and names its label;
 * unverifiable, contended, and invalid configurations are attention, never silent.
 */
export function nonOwnerHealth(verdict: ConvergenceOwnerVerdict): {
  state: KnowledgeResidentState;
  reason: string;
} {
  switch (verdict.role) {
    case "waiting_owner":
      return {
        state: "waiting",
        reason: `waiting_owner:${verdict.holder?.label ?? verdict.holder?.hostHash.slice(7, 19) ?? "unknown"}`,
      };
    case "ineligible":
      return { state: "waiting", reason: verdict.reason };
    case "yielding":
      return { state: "waiting", reason: "convergence_owner_released" };
    default:
      return { state: "attention", reason: verdict.reason };
  }
}
