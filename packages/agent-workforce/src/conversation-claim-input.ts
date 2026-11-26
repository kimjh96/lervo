import { repositoryPathWithinScope } from "@lervo/work-controller";
import { MAXIMUM_CONVERSATION_EXPECTED_PATHS } from "./assignment-path-bounds.js";
import type { ChangedPathHolder } from "./assignment-path-conflict.js";
import { minimalPathCover } from "./conversation-lease-coalescing.js";
import { AGENT_ID, ASSIGNMENT_ID, safePath } from "./workforce-state-validation.js";

const WORKSPACE_ID = /^wsp_[a-f0-9]{24}$/u;

/**
 * A claimed path under the workforce path policy: repository-relative and normalized, never `.` or
 * `*`, which would block every other agent. A trailing `/` naming a directory is dropped. A glob
 * character is refused: the handler claims the deepest directory before a wildcard instead.
 */
export function normalizeClaimPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const path = value.replace(/\/+$/u, "");
  return path !== "." &&
    !/[*?[\]]/u.test(path) &&
    safePath(path) &&
    repositoryPathWithinScope(path, ".")
    ? path
    : null;
}

/** The request's paths as a minimal sorted cover, or null when any path is invalid. */
export function normalizeClaimPaths(values: readonly unknown[]): string[] | null {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.length > MAXIMUM_CONVERSATION_EXPECTED_PATHS
  )
    return null;
  const paths = values.map(normalizeClaimPath);
  return paths.every((path): path is string => path !== null) ? minimalPathCover(paths) : null;
}

export function validClaimantWorkspaceId(value: unknown): value is string | null | undefined {
  return (
    value === undefined || value === null || (typeof value === "string" && WORKSPACE_ID.test(value))
  );
}

export function validChangedPathHolder(value: unknown): value is ChangedPathHolder {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const holder = value as ChangedPathHolder;
  return (
    normalizeClaimPath(holder.path) === holder.path &&
    typeof holder.holderAgentId === "string" &&
    AGENT_ID.test(holder.holderAgentId) &&
    typeof holder.holderWorkspaceId === "string" &&
    WORKSPACE_ID.test(holder.holderWorkspaceId) &&
    (holder.holderAssignmentId === undefined ||
      holder.holderAssignmentId === null ||
      (typeof holder.holderAssignmentId === "string" &&
        ASSIGNMENT_ID.test(holder.holderAssignmentId))) &&
    (holder.code === "path_changed_unsealed" || holder.code === "path_awaiting_integration")
  );
}
