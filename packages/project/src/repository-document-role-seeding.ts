import {
  defaultRepositoryDocumentPolicy,
  type RepositoryDocumentRole,
} from "./repository-document-policy.js";

/**
 * Lervo's layout templates for product documents. They are seeded only into repositories that
 * already hold the canonical path or a legacy alias, so another repository never inherits Lervo's
 * own document layout as if it were declared there.
 */
const conditionalDefaultRoleIds = new Set([
  "product_vision",
  "system_architecture",
  "execution_specification",
  "delivery_roadmap",
]);

export function documentRoleCandidatePaths(role: RepositoryDocumentRole): string[] {
  return [role.path, ...(role.legacyAliases ?? [])];
}

function sameRole(left: RepositoryDocumentRole, right: RepositoryDocumentRole): boolean {
  const aliases = (role: RepositoryDocumentRole) => JSON.stringify(role.legacyAliases ?? []);
  return (
    left.roleId === right.roleId &&
    left.scopePath === right.scopePath &&
    left.path === right.path &&
    left.cardinality === right.cardinality &&
    left.lifecycleOwner === right.lifecycleOwner &&
    left.relocation === right.relocation &&
    left.rewritePolicy === right.rewritePolicy &&
    left.required === right.required &&
    aliases(left) === aliases(right)
  );
}

/** True only for an unmodified Lervo template entry; any repository edit makes the role declared. */
export function isConditionalDefaultDocumentRole(role: RepositoryDocumentRole): boolean {
  if (!conditionalDefaultRoleIds.has(role.roleId)) return false;
  const template = defaultRepositoryDocumentPolicy.roles.find(
    (item) => item.roleId === role.roleId,
  );
  return template !== undefined && sameRole(role, template);
}

/** An unmodified template whose canonical path and every legacy alias are absent. */
export function isUnboundDefaultDocumentRole(
  role: RepositoryDocumentRole,
  pathExists: (path: string) => boolean,
): boolean {
  return (
    isConditionalDefaultDocumentRole(role) &&
    !documentRoleCandidatePaths(role).some((path) => pathExists(path))
  );
}

/** The Lervo template path for a conditional role, used only to place a recognized document. */
export function conditionalDefaultDocumentRolePath(roleId: string): string | null {
  if (!conditionalDefaultRoleIds.has(roleId)) return null;
  return defaultRepositoryDocumentPolicy.roles.find((role) => role.roleId === roleId)?.path ?? null;
}

/**
 * Keeps declared roles and drops unbound Lervo templates, preserving order. A template is
 * re-added only when the caller places a document at its path (`placedPaths`), so a role a
 * repository removed is never restored merely because a file exists.
 */
export function seedRepositoryDocumentRoles(
  roles: readonly RepositoryDocumentRole[],
  pathExists: (path: string) => boolean,
  placedPaths: ReadonlySet<string> = new Set(),
): RepositoryDocumentRole[] {
  const exists = (path: string) => pathExists(path) || placedPaths.has(path);
  const kept = roles.filter((role) => !isUnboundDefaultDocumentRole(role, exists));
  const present = new Set(kept.map((role) => `${role.scopePath}:${role.roleId}`));
  const restored = defaultRepositoryDocumentPolicy.roles.filter(
    (role) =>
      conditionalDefaultRoleIds.has(role.roleId) &&
      !present.has(`${role.scopePath}:${role.roleId}`) &&
      placedPaths.has(role.path),
  );
  return [...kept, ...restored];
}
