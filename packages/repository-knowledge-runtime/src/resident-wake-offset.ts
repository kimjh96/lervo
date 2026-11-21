import { createHash } from "node:crypto";

/** ADR-0597: the widest spread of shared wake moments across one host's residents. */
export const RESIDENT_WAKE_OFFSET_MAXIMUM_MILLISECONDS = 15 * 60_000;

/**
 * A stable per-project delay, from 0 to 15 minutes, for wake moments that every resident would
 * otherwise share: the UTC day boundary and the daily usage moments. Spreading them keeps a host's
 * residents from starting full cycles together and starving the event loop.
 */
export function residentWakeOffset(projectId: string): number {
  const digest = createHash("sha256").update(projectId).digest();
  return digest.readUInt32BE(0) % (RESIDENT_WAKE_OFFSET_MAXIMUM_MILLISECONDS + 1);
}
