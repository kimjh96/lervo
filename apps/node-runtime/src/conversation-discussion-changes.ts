/**
 * ADR-0602: in-process change listeners per discussion store path. Only this Node process opens its
 * data directory's discussion store, so every committed write reaches every listener of that path.
 */
const listenersByPath = new Map<string, Set<() => void>>();

export function subscribeDiscussionChanges(path: string, notify: () => void): () => void {
  const listeners = listenersByPath.get(path) ?? new Set<() => void>();
  listenersByPath.set(path, listeners);
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
    if (listeners.size === 0) listenersByPath.delete(path);
  };
}

/** Runs after the committing call returns, so a listener never runs inside its transaction. */
export function announceDiscussionChange(path: string): void {
  const listeners = [...(listenersByPath.get(path) ?? [])];
  if (listeners.length > 0) queueMicrotask(() => listeners.forEach((notify) => notify()));
}
