export type DecisionTaxonomyIssueRule =
  | "required"
  | "type"
  | "const"
  | "pattern"
  | "range"
  | "enum"
  | "min_items"
  | "max_items"
  | "unique"
  | "repository_path"
  | "document_path"
  | "title_term";

export interface DecisionTaxonomyIssue {
  /** RFC 6901 JSON pointer into the parsed document-layout.yaml value. */
  pointer: string;
  rule: DecisionTaxonomyIssueRule;
  roleId?: string;
  message: string;
}

type Mapping = Record<string, unknown>;

const roleIdPattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u;
const routeIdPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const taxonomyIdPattern = /^[a-z][a-z0-9._-]{2,63}$/u;

function safeRepositoryPath(value: unknown, maximumSegments: number): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 160 ||
    value.startsWith("/") ||
    value.endsWith("/")
  )
    return false;
  const segments = value.split("/");
  return (
    segments.length <= maximumSegments &&
    segments.every(
      (segment) => /^[a-z0-9][a-z0-9._-]*$/u.test(segment) && segment !== "." && segment !== "..",
    )
  );
}

function safeDocumentPath(value: unknown, maximumSegments: number): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 240 ||
    value.startsWith("/") ||
    value.endsWith("/")
  )
    return false;
  const segments = value.split("/");
  return (
    segments.length <= maximumSegments &&
    segments.every(
      (segment) =>
        /^\.?[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment) && segment !== "." && segment !== "..",
    )
  );
}

function isMapping(value: unknown): value is Mapping {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

class IssueCollector {
  readonly issues: DecisionTaxonomyIssue[] = [];

  add(
    pointer: string,
    rule: DecisionTaxonomyIssueRule,
    description: string,
    roleId?: string,
  ): void {
    this.issues.push({
      pointer,
      rule,
      ...(roleId === undefined ? {} : { roleId }),
      message: `${pointer === "" ? "The document layout" : pointer} ${description}.`,
    });
  }

  mapping(value: unknown, pointer: string, roleId?: string): value is Mapping {
    if (isMapping(value)) return true;
    if (value === undefined) this.add(pointer, "required", "is required", roleId);
    else this.add(pointer, "type", "must be a mapping", roleId);
    return false;
  }

  array(value: unknown, pointer: string, maximum: number, minimum = 0): value is unknown[] {
    if (!Array.isArray(value)) {
      if (value === undefined) this.add(pointer, "required", "is required");
      else this.add(pointer, "type", "must be a list");
      return false;
    }
    if (value.length < minimum)
      this.add(pointer, "min_items", `must contain at least ${minimum} item(s)`);
    if (value.length > maximum)
      this.add(pointer, "max_items", `must contain at most ${maximum} item(s)`);
    return true;
  }

  integer(
    value: unknown,
    pointer: string,
    minimum: number,
    maximum: number,
    roleId?: string,
  ): value is number {
    if (Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum)
      return true;
    if (value === undefined) this.add(pointer, "required", "is required", roleId);
    else this.add(pointer, "range", `must be an integer from ${minimum} to ${maximum}`, roleId);
    return false;
  }

  oneOf(value: unknown, pointer: string, allowed: readonly string[], roleId?: string): void {
    if (typeof value === "string" && allowed.includes(value)) return;
    if (value === undefined) this.add(pointer, "required", "is required", roleId);
    else this.add(pointer, "enum", `must be one of ${allowed.join(", ")}`, roleId);
  }
}

function validateCapacity(capacity: Mapping, pointer: string, issues: IssueCollector): void {
  const directValid = issues.integer(
    capacity.maxDirectDocuments,
    `${pointer}/maxDirectDocuments`,
    4,
    1024,
  );
  const childValid = issues.integer(
    capacity.maxDocumentBearingChildDirectories,
    `${pointer}/maxDocumentBearingChildDirectories`,
    4,
    256,
  );
  issues.integer(capacity.maxRepositoryDocuments, `${pointer}/maxRepositoryDocuments`, 64, 16_384);
  if (capacity.maxNormalizedFamilyOutputs !== 12)
    issues.add(
      `${pointer}/maxNormalizedFamilyOutputs`,
      capacity.maxNormalizedFamilyOutputs === undefined ? "required" : "const",
      capacity.maxNormalizedFamilyOutputs === undefined ? "is required" : "must equal 12",
    );
  const overrides = capacity.overrides;
  if (!issues.array(overrides, `${pointer}/overrides`, 64)) return;
  const directMinimum = directValid ? Number(capacity.maxDirectDocuments) : 4;
  const childMinimum = childValid ? Number(capacity.maxDocumentBearingChildDirectories) : 4;
  const scopes = new Set<string>();
  overrides.forEach((override, index) => {
    const at = `${pointer}/overrides/${index}`;
    if (!issues.mapping(override, at)) return;
    if (!safeRepositoryPath(override.scopePath, 12))
      issues.add(`${at}/scopePath`, "repository_path", "must be a safe repository path");
    else if (scopes.has(override.scopePath))
      issues.add(`${at}/scopePath`, "unique", "duplicates an earlier override scope");
    else scopes.add(override.scopePath);
    issues.oneOf(override.role, `${at}/role`, ["archive", "catalog", "generated_reference"]);
    issues.integer(override.maxDirectDocuments, `${at}/maxDirectDocuments`, directMinimum, 1024);
    issues.integer(
      override.maxDocumentBearingChildDirectories,
      `${at}/maxDocumentBearingChildDirectories`,
      childMinimum,
      256,
    );
  });
}

function validateRole(
  role: Mapping,
  pointer: string,
  coordinates: Set<string>,
  issues: IssueCollector,
): void {
  const roleId = typeof role.roleId === "string" ? role.roleId : undefined;
  if (roleId === undefined || !roleIdPattern.test(roleId))
    issues.add(
      `${pointer}/roleId`,
      role.roleId === undefined ? "required" : "pattern",
      role.roleId === undefined ? "is required" : "must be a lowercase snake_case identifier",
    );
  if (!(role.scopePath === "." || safeRepositoryPath(role.scopePath, 12)))
    issues.add(
      `${pointer}/scopePath`,
      "repository_path",
      "must be . or a safe repository path",
      roleId,
    );
  if (!safeDocumentPath(role.path, 12))
    issues.add(`${pointer}/path`, "document_path", "must be a safe document path", roleId);
  issues.oneOf(role.cardinality, `${pointer}/cardinality`, ["one", "one_per_package"], roleId);
  issues.oneOf(
    role.lifecycleOwner,
    `${pointer}/lifecycleOwner`,
    ["user", "lervo", "provider_adapter"],
    roleId,
  );
  issues.oneOf(
    role.relocation,
    `${pointer}/relocation`,
    ["preserve", "reviewed_move", "exact_legacy_alias"],
    roleId,
  );
  issues.oneOf(
    role.rewritePolicy,
    `${pointer}/rewritePolicy`,
    ["repository_tool", "lervo_exact", "reviewed_exact", "managed_regions"],
    roleId,
  );
  if (typeof role.required !== "boolean")
    issues.add(
      `${pointer}/required`,
      role.required === undefined ? "required" : "type",
      role.required === undefined ? "is required" : "must be a boolean",
      roleId,
    );
  if (role.legacyAliases !== undefined) {
    if (!Array.isArray(role.legacyAliases))
      issues.add(`${pointer}/legacyAliases`, "type", "must be a list", roleId);
    else {
      if (role.legacyAliases.length > 16)
        issues.add(
          `${pointer}/legacyAliases`,
          "max_items",
          "must contain at most 16 item(s)",
          roleId,
        );
      role.legacyAliases.forEach((alias, index) => {
        if (!safeDocumentPath(alias, 12))
          issues.add(
            `${pointer}/legacyAliases/${index}`,
            "document_path",
            "must be a safe document path",
            roleId,
          );
      });
    }
  }
  const coordinate = `${String(role.scopePath)}:${String(role.roleId)}`;
  if (coordinates.has(coordinate))
    issues.add(
      `${pointer}/roleId`,
      "unique",
      "duplicates an earlier role in the same scope",
      roleId,
    );
  coordinates.add(coordinate);
}

function validateDocumentPolicy(value: unknown, pointer: string, issues: IssueCollector): void {
  if (!issues.mapping(value, pointer)) return;
  if (issues.mapping(value.capacity, `${pointer}/capacity`))
    validateCapacity(value.capacity, `${pointer}/capacity`, issues);
  if (issues.array(value.roles, `${pointer}/roles`, 128)) {
    const coordinates = new Set<string>();
    value.roles.forEach((role, index) => {
      if (issues.mapping(role, `${pointer}/roles/${index}`))
        validateRole(role, `${pointer}/roles/${index}`, coordinates, issues);
    });
  }
  const rewrite = value.rewrite;
  if (issues.mapping(rewrite, `${pointer}/rewrite`)) {
    issues.integer(rewrite.maxRewriters, `${pointer}/rewrite/maxRewriters`, 1, 16);
    issues.integer(
      rewrite.maxManagedRulesPerRewriter,
      `${pointer}/rewrite/maxManagedRulesPerRewriter`,
      1,
      1024,
    );
    issues.integer(
      rewrite.maxManagedRuleBytes,
      `${pointer}/rewrite/maxManagedRuleBytes`,
      256,
      65_536,
    );
  }
}

function validateRoute(
  route: Mapping,
  pointer: string,
  seen: { ids: Set<string>; paths: Set<string> },
  issues: IssueCollector,
): void {
  if (typeof route.id !== "string" || !routeIdPattern.test(route.id))
    issues.add(
      `${pointer}/id`,
      route.id === undefined ? "required" : "pattern",
      route.id === undefined ? "is required" : "must be a lowercase route identifier",
    );
  else if (seen.ids.has(route.id))
    issues.add(`${pointer}/id`, "unique", "duplicates an earlier route id");
  else seen.ids.add(route.id);
  if (!safeRepositoryPath(route.path, 5))
    issues.add(
      `${pointer}/path`,
      route.path === undefined ? "required" : "repository_path",
      route.path === undefined ? "is required" : "must be a safe path of at most 5 segments",
    );
  else if (seen.paths.has(route.path))
    issues.add(`${pointer}/path`, "unique", "duplicates an earlier route path");
  else seen.paths.add(route.path);
  issues.integer(route.priority, `${pointer}/priority`, 0, 1000);
  const minimumValid = issues.integer(
    route.minimumTitleTermMatches,
    `${pointer}/minimumTitleTermMatches`,
    1,
    8,
  );
  const minimum = minimumValid ? Number(route.minimumTitleTermMatches) : 1;
  if (!issues.array(route.titleTerms, `${pointer}/titleTerms`, 64, minimum)) return;
  const terms = new Set<string>();
  route.titleTerms.forEach((term, index) => {
    if (typeof term !== "string" || term.trim() !== term || term.length < 2 || term.length > 80) {
      issues.add(
        `${pointer}/titleTerms/${index}`,
        "title_term",
        "must be a trimmed string of 2 to 80 characters",
      );
      return;
    }
    const normalized = term.toLocaleLowerCase();
    if (terms.has(normalized))
      issues.add(`${pointer}/titleTerms/${index}`, "unique", "duplicates an earlier title term");
    terms.add(normalized);
  });
}

/**
 * Returns every decision taxonomy contract violation with its JSON pointer.
 * An empty result means the value satisfies the schemaVersion 2 contract.
 */
export function decisionTaxonomyIssues(value: unknown): DecisionTaxonomyIssue[] {
  const issues = new IssueCollector();
  if (!issues.mapping(value, "")) return issues.issues;
  if (value.schemaVersion !== 2)
    issues.add(
      "/schemaVersion",
      value.schemaVersion === undefined ? "required" : "const",
      value.schemaVersion === undefined ? "is required" : "must equal 2",
    );
  if (typeof value.taxonomyId !== "string" || !taxonomyIdPattern.test(value.taxonomyId))
    issues.add(
      "/taxonomyId",
      value.taxonomyId === undefined ? "required" : "pattern",
      value.taxonomyId === undefined ? "is required" : "must be a lowercase identifier",
    );
  if (!safeRepositoryPath(value.decisionRoot, 6))
    issues.add(
      "/decisionRoot",
      value.decisionRoot === undefined ? "required" : "repository_path",
      value.decisionRoot === undefined ? "is required" : "must be a safe repository path",
    );
  if (issues.array(value.legacyRoots, "/legacyRoots", 8)) {
    const roots = new Set<unknown>();
    value.legacyRoots.forEach((root, index) => {
      if (!safeRepositoryPath(root, 6))
        issues.add(`/legacyRoots/${index}`, "repository_path", "must be a safe repository path");
      else if (roots.has(root))
        issues.add(`/legacyRoots/${index}`, "unique", "duplicates an earlier legacy root");
      roots.add(root);
    });
  }
  issues.integer(value.maxLeafDocuments, "/maxLeafDocuments", 4, 128);
  if (issues.array(value.routes, "/routes", 128, 1)) {
    const seen = { ids: new Set<string>(), paths: new Set<string>() };
    value.routes.forEach((route, index) => {
      if (issues.mapping(route, `/routes/${index}`))
        validateRoute(route, `/routes/${index}`, seen, issues);
    });
  }
  validateDocumentPolicy(value.documentPolicy, "/documentPolicy", issues);
  return issues.issues;
}
