/**
 * The resident's read-only projection refresh, one at a time. A request during a refresh runs once
 * more afterwards, so a cycle's result is never missed; failures go to `onFailure`.
 */
export function coalescedRefresh(
  refreshHealth: (() => Promise<void>) | undefined,
  signal: AbortSignal,
  onFailure: (error: unknown) => void,
): { refresh(): Promise<void>; running(): Promise<void> | null } {
  let current: Promise<void> | null = null;
  let again = false;
  const refresh = (): Promise<void> => {
    if (refreshHealth === undefined || signal.aborted) return Promise.resolve();
    if (current !== null) {
      again = true;
      return current;
    }
    current = (async () => {
      try {
        do {
          again = false;
          await refreshHealth().catch((error: unknown) => onFailure(error));
        } while (again && !signal.aborted);
      } finally {
        // Cleared in the same turn as the last loop check, so no request lands in between.
        current = null;
      }
    })();
    return current;
  };
  return { refresh, running: () => current };
}
