/**
 * The resident's read-only projection refresh, one at a time. A request during a refresh runs once
 * more afterwards, so a cycle's result is never missed; failures go to `onFailure`. The promise
 * resolves to whether the last run succeeded, so a caller records only a refresh that happened.
 */
export function coalescedRefresh(
  refreshHealth: (() => Promise<void>) | undefined,
  signal: AbortSignal,
  onFailure: (error: unknown) => void,
): { refresh(): Promise<boolean>; running(): Promise<boolean> | null } {
  let current: Promise<boolean> | null = null;
  let again = false;
  const refresh = (): Promise<boolean> => {
    if (refreshHealth === undefined || signal.aborted) return Promise.resolve(false);
    if (current !== null) {
      again = true;
      return current;
    }
    current = (async () => {
      let succeeded: boolean;
      try {
        do {
          again = false;
          succeeded = await refreshHealth().then(
            () => true,
            (error: unknown) => {
              onFailure(error);
              return false;
            },
          );
        } while (again && !signal.aborted);
      } finally {
        // Cleared in the same turn as the last loop check, so no request lands in between.
        current = null;
      }
      return succeeded;
    })();
    return current;
  };
  return { refresh, running: () => current };
}
