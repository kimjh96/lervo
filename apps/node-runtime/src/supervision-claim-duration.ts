import type { WorkResponsibilityV1 } from "@lervo/application-contract";

/** Reserve the five-second admission observation window before the task's absolute deadline. */
/** Time reserved between a proposed claim and its fenced acquisition. */
export const CLAIM_ADMISSION_MARGIN_MS = 30_000;

export function supervisionClaimDuration(task: WorkResponsibilityV1, now: string): number {
  // The margin covers admission latency between proposal and fenced acquisition.
  const available =
    Date.parse(task.completionDeadline) - Date.parse(now) - CLAIM_ADMISSION_MARGIN_MS;
  const duration = Math.min(300_000, Math.floor(available / 1000) * 1000);
  if (!Number.isSafeInteger(duration) || duration < 5000)
    throw new Error("The responsibility has insufficient time for a fresh bounded lease claim.");
  return duration;
}
