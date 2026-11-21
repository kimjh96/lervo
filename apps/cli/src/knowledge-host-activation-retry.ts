/**
 * A held checkout retries automatic activation at most this often; between retries a scan only
 * reads the writer coordinate, so an activation done elsewhere is picked up on the next scan.
 */
export const HOST_RESIDENT_ACTIVATION_RETRY_MILLISECONDS = 30 * 60_000;
export const HOST_RESIDENT_ACTIVATION_RETRY_CEILING_MILLISECONDS = 8 * 60 * 60_000;

/** Activation blockers a watched local file clears; the rest need a remote reader to change. */
const SIGNALLED_ACTIVATION_BLOCKERS: ReadonlySet<string> = new Set([
  "terminal_hook_reader_stale",
  "reader_inventory_fleet_unavailable",
  "reader_inventory_config_invalid",
  "event_writer_recovery_required",
  "event_writer_coordinate_invalid",
  "event_writer_plan_stale",
]);

function activationSignalled(detail: string | null): boolean {
  return detail !== null && SIGNALLED_ACTIVATION_BLOCKERS.has(detail);
}

/**
 * ADR-0602: when a held checkout tries automatic activation again. A blocker a watched local
 * file clears waits for that file (Infinity); one only a remote reader can clear backs off from
 * the retry bound, doubling to the ceiling.
 */
export function activationRetryAt(detail: string | null, attempts: number, now: number): number {
  if (activationSignalled(detail)) return Number.POSITIVE_INFINITY;
  return (
    now +
    Math.min(
      HOST_RESIDENT_ACTIVATION_RETRY_CEILING_MILLISECONDS,
      HOST_RESIDENT_ACTIVATION_RETRY_MILLISECONDS * 2 ** Math.min(attempts - 1, 8),
    )
  );
}
