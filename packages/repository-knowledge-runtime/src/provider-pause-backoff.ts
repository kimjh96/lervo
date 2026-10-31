const HOUR_MS = 60 * 60_000;

/** The first probe follows the native failure; later attempts double their delay to one day. */
export function providerPauseReprobeAt(pause: {
  observed_at?: unknown;
  last_reprobe_at?: unknown;
  reprobe_attempts?: unknown;
}): number {
  const attempts = Math.min(32, Math.max(0, Number(pause.reprobe_attempts ?? 0)));
  const anchor = Number(pause.last_reprobe_at ?? pause.observed_at);
  return anchor + HOUR_MS * Math.min(24, 2 ** attempts);
}
