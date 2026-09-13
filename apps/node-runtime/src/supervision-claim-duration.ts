import type { WorkResponsibilityV1 } from "@lervo/application-contract";

/** Reserve the five-second admission observation window before the task's absolute deadline. */
export function supervisionClaimDuration(task: WorkResponsibilityV1, now: string): number {
  const available = Date.parse(task.completionDeadline) - Date.parse(now) - 5000;
  const duration = Math.min(300_000, Math.floor(available / 1000) * 1000);
  if (!Number.isSafeInteger(duration) || duration < 5000)
    throw new Error("The responsibility has insufficient time for a fresh bounded lease claim.");
  return duration;
}
