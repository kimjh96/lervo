import {
  conditionalDefaultDocumentRolePath,
  defaultRepositoryDocumentPolicy,
  type DecisionTaxonomy,
} from "@lervo/project";

/**
 * A repository-root document role a legacy document can move into (ADR-0476): every role the
 * layout declares with `reviewed_move` relocation, plus the Lervo role templates a plan may bind.
 * The catalog depends on role identities and paths only, so binding or pruning a template never
 * invalidates a recorded classification.
 */
export interface PlaceableDocumentRole {
  roleId: string;
  path: string;
  /** Exact repository paths the reviewed layout declares as this role's legacy names. */
  legacyAliases: string[];
}

const catalogs = new WeakMap<DecisionTaxonomy, PlaceableDocumentRole[]>();

export function placeableDocumentRoles(taxonomy: DecisionTaxonomy): PlaceableDocumentRole[] {
  const cached = catalogs.get(taxonomy);
  if (cached !== undefined) return cached;
  const declared = taxonomy.documentPolicy.roles.filter(
    (role) => role.scopePath === "." && role.relocation === "reviewed_move",
  );
  const templates = defaultRepositoryDocumentPolicy.roles.filter(
    (role) =>
      role.relocation === "reviewed_move" &&
      conditionalDefaultDocumentRolePath(role.roleId) !== null &&
      !declared.some((item) => item.roleId === role.roleId),
  );
  const catalog = [...declared, ...templates]
    .map((role) => ({
      roleId: role.roleId,
      path: role.path,
      legacyAliases: [...(role.legacyAliases ?? [])].sort(),
    }))
    .sort((left, right) => left.roleId.localeCompare(right.roleId));
  catalogs.set(taxonomy, catalog);
  return catalog;
}

export function placeableDocumentRole(
  taxonomy: DecisionTaxonomy,
  roleId: string,
): PlaceableDocumentRole | null {
  return placeableDocumentRoles(taxonomy).find((role) => role.roleId === roleId) ?? null;
}

/** The role whose reviewed layout declares this exact path as a legacy alias. */
export function declaredLegacyAliasRole(
  taxonomy: DecisionTaxonomy,
  path: string,
): PlaceableDocumentRole | null {
  return placeableDocumentRoles(taxonomy).find((role) => role.legacyAliases.includes(path)) ?? null;
}
