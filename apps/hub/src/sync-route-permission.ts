import type { HubPermission } from "./auth.js";
import type { HubSyncHttpRoute } from "./sync-request.js";

const KNOWLEDGE_COORDINATION_ROUTES: ReadonlySet<HubSyncHttpRoute["kind"]> = new Set([
  "knowledge-convergence-owner",
  "knowledge-instruction-candidates",
  "knowledge-convergence-hosts",
]);

/** The permission a sync route names explicitly. */
export function requiredSyncRoutePermission(
  kind: HubSyncHttpRoute["kind"],
  method: string | undefined,
): HubPermission {
  if (kind.startsWith("workspace-") || KNOWLEDGE_COORDINATION_ROUTES.has(kind))
    return method === "GET" ? "workspace.read" : "workspace.coordinate";
  if (kind === "workstreams") return method === "GET" ? "workstream.read" : "workstream.write";
  return "sync.write";
}

/**
 * ADR-0469: a principal that may write a project's synchronized events may also coordinate that
 * project's background knowledge. Knowledge coordination routes therefore accept `sync.write` in
 * place of `workspace.read` or `workspace.coordinate`. The project scope check is unchanged, and
 * workspace reservations still require their explicit permissions.
 */
export function syncRoutePermitted(input: {
  kind: HubSyncHttpRoute["kind"];
  method: string | undefined;
  permissions: readonly HubPermission[];
}): boolean {
  if (input.permissions.includes(requiredSyncRoutePermission(input.kind, input.method)))
    return true;
  return KNOWLEDGE_COORDINATION_ROUTES.has(input.kind) && input.permissions.includes("sync.write");
}
