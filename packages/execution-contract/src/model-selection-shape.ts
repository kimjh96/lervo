/**
 * ADR-0612 M3: the shapes a selection may take when it crosses hosts. A change time is strict UTC,
 * and a role this Lervo does not know is kept only in the flat route shape, so a peer can never
 * make the local file deep, large, or ambiguous to order.
 */
const MAXIMUM_OPAQUE_ROUTES = 4;
const SELECTION_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** A strict UTC ISO-8601 change time, as `Date.prototype.toISOString` writes it. */
export function isSelectionTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SELECTION_TIMESTAMP.test(value) &&
    new Date(value).toISOString() === value
  );
}

/** 1 to 4 routes of exactly provider, model, and effort, each a short string or null. */
export function isOpaqueRouteList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAXIMUM_OPAQUE_ROUTES &&
    value.every(
      (route) =>
        route !== null &&
        typeof route === "object" &&
        !Array.isArray(route) &&
        Object.keys(route).sort().join(",") === "model,provider,reasoningEffort" &&
        Object.values(route as Record<string, unknown>).every(
          (item) => item === null || (typeof item === "string" && item.length <= 128),
        ) &&
        typeof (route as Record<string, unknown>).provider === "string",
    )
  );
}

/**
 * ADR-0612 M3: a change is stamped after the selection it replaces, even when this host's clock
 * is behind the host that wrote it, so a local change always orders after what it changed.
 */
export function nextChangeTime(current: { changedAt: string | null }, now: Date): string {
  const previous = current.changedAt === null ? -Infinity : Date.parse(current.changedAt);
  return new Date(Math.max(now.getTime(), previous + 1)).toISOString();
}
