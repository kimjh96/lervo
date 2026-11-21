import {
  CONTINUITY_ATTENTION_LEAD_MS,
  CONTINUITY_PEER_ABSENT_GRACE_MS,
  CONTINUITY_PEER_STALE_MS,
  type ContinuityPeerObservation,
} from "./continuity-findings.js";

/** A failed reconciliation retries after base × 2^(failures − 1), up to the ceiling. */
export const CONTINUITY_RETRY_BASE_MILLISECONDS = 60_000;
export const CONTINUITY_RETRY_CEILING_MILLISECONDS = 60 * 60_000;

export function continuityRetryDelay(failures: number): number {
  return Math.min(
    CONTINUITY_RETRY_CEILING_MILLISECONDS,
    CONTINUITY_RETRY_BASE_MILLISECONDS * 2 ** Math.min(Math.max(0, failures - 1), 30),
  );
}

function moment(value: string | null | undefined, offset = 0): number | null {
  if (value === null || value === undefined) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? at + offset : null;
}

/**
 * ADR-0602: when continuity must look again with no input changed: the first future moment a
 * time-based decision or finding turns (a renewal window opens, an attention lead or an expiry is
 * reached for this host's delegation and policy horizon or a peer's delegation, a disconnected
 * peer outlasts its grace, a provider pause resets or is reprobed), or a failure retry with
 * exponential backoff. Null when nothing turns by time; every other input is a change signal.
 */
export function continuityNextDeadline(input: {
  now: number;
  failures: number;
  renewAt: string | null;
  delegationExpiresAt: string | null;
  policyHorizonAt: string | null;
  peers: readonly ContinuityPeerObservation[];
  pauses: readonly { resetAt: string | null; nextReprobeAt: string | null }[];
}): number | null {
  const moments: (number | null)[] = [
    moment(input.renewAt),
    moment(input.delegationExpiresAt, -CONTINUITY_ATTENTION_LEAD_MS),
    moment(input.delegationExpiresAt),
    moment(input.policyHorizonAt, -CONTINUITY_ATTENTION_LEAD_MS),
    moment(input.policyHorizonAt),
  ];
  for (const peer of input.peers) {
    moments.push(moment(peer.delegationExpiresAt, -CONTINUITY_ATTENTION_LEAD_MS));
    if (peer.presence === undefined)
      moments.push(moment(peer.observedAt, CONTINUITY_PEER_STALE_MS));
    else if (!peer.presence.connected)
      moments.push(moment(peer.presence.since, CONTINUITY_PEER_ABSENT_GRACE_MS));
  }
  for (const pause of input.pauses)
    moments.push(moment(pause.resetAt), moment(pause.nextReprobeAt));
  if (input.failures > 0) moments.push(input.now + continuityRetryDelay(input.failures));
  // A moment is due strictly after now, so a passed one never rearms itself.
  const future = moments.filter((at): at is number => at !== null && at > input.now);
  return future.length === 0 ? null : Math.min(...future);
}
