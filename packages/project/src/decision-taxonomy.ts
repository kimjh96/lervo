import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, stringify } from "yaml";

import { LervoProjectError } from "./types.js";
import {
  defaultRepositoryDocumentPolicy,
  type RepositoryDocumentPolicy,
} from "./repository-document-policy.js";

export interface DecisionTaxonomyRoute {
  id: string;
  path: string;
  priority: number;
  minimumTitleTermMatches: number;
  titleTerms: string[];
}

export interface DecisionTaxonomy {
  schemaVersion: 2;
  taxonomyId: string;
  decisionRoot: string;
  legacyRoots: string[];
  maxLeafDocuments: number;
  routes: DecisionTaxonomyRoute[];
  documentPolicy: RepositoryDocumentPolicy;
}

export const defaultDecisionTaxonomy: DecisionTaxonomy = {
  schemaVersion: 2,
  taxonomyId: "decisions.default",
  decisionRoot: "docs/decisions",
  legacyRoots: ["docs/adr"],
  maxLeafDocuments: 24,
  documentPolicy: defaultRepositoryDocumentPolicy,
  routes: [
    {
      id: "security",
      path: "security",
      priority: 100,
      minimumTitleTermMatches: 1,
      titleTerms: [
        "security",
        "authentication",
        "authorization",
        "credential",
        "privacy",
        "encryption",
      ],
    },
    {
      id: "data",
      path: "data",
      priority: 90,
      minimumTitleTermMatches: 1,
      titleTerms: ["data", "database", "schema", "storage", "persistence", "migration"],
    },
    {
      id: "architecture",
      path: "architecture",
      priority: 80,
      minimumTitleTermMatches: 1,
      titleTerms: [
        "architecture",
        "system boundary",
        "component",
        "integration",
        "protocol",
        "api",
      ],
    },
    {
      id: "product",
      path: "product",
      priority: 70,
      minimumTitleTermMatches: 1,
      titleTerms: ["product", "user experience", "requirement", "scope", "workflow", "feature"],
    },
    {
      id: "delivery",
      path: "delivery",
      priority: 60,
      minimumTitleTermMatches: 1,
      titleTerms: [
        "release",
        "deployment",
        "deploy",
        "distribution",
        "packaging",
        "build",
        "continuous integration",
      ],
    },
    {
      id: "operations",
      path: "operations",
      priority: 50,
      minimumTitleTermMatches: 1,
      titleTerms: [
        "runtime",
        "operations",
        "observability",
        "monitoring",
        "doctor",
        "diagnostic",
        "incident",
        "recovery",
      ],
    },
    {
      id: "quality",
      path: "quality",
      priority: 40,
      minimumTitleTermMatches: 1,
      titleTerms: [
        "testing",
        "verification",
        "quality",
        "reliability",
        "performance",
        "accessibility",
      ],
    },
    {
      id: "development",
      path: "development",
      priority: 30,
      minimumTitleTermMatches: 1,
      titleTerms: ["developer tooling", "dependency", "code style", "repository", "monorepo"],
    },
  ],
};

export function serializeDecisionTaxonomy(taxonomy = defaultDecisionTaxonomy): string {
  return stringify(taxonomy, { lineWidth: 0 });
}

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

function finiteInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function validateDocumentPolicy(value: unknown): value is RepositoryDocumentPolicy {
  const policy = value as Partial<RepositoryDocumentPolicy> | null;
  const capacity = policy?.capacity;
  const rewrite = policy?.rewrite;
  if (
    policy === null ||
    typeof policy !== "object" ||
    capacity === undefined ||
    !finiteInteger(capacity.maxDirectDocuments, 4, 1024) ||
    !finiteInteger(capacity.maxDocumentBearingChildDirectories, 4, 256) ||
    !finiteInteger(capacity.maxRepositoryDocuments, 64, 16_384) ||
    capacity.maxNormalizedFamilyOutputs !== 12 ||
    !Array.isArray(capacity.overrides) ||
    capacity.overrides.length > 64 ||
    !Array.isArray(policy.roles) ||
    policy.roles.length > 128 ||
    rewrite === undefined ||
    !finiteInteger(rewrite.maxRewriters, 1, 16) ||
    !finiteInteger(rewrite.maxManagedRulesPerRewriter, 1, 1024) ||
    !finiteInteger(rewrite.maxManagedRuleBytes, 256, 65_536)
  )
    return false;
  const overrideScopes = new Set<string>();
  for (const override of capacity.overrides) {
    if (
      !safeRepositoryPath(override.scopePath, 12) ||
      !["archive", "catalog", "generated_reference"].includes(override.role) ||
      !finiteInteger(override.maxDirectDocuments, capacity.maxDirectDocuments, 1024) ||
      !finiteInteger(
        override.maxDocumentBearingChildDirectories,
        capacity.maxDocumentBearingChildDirectories,
        256,
      ) ||
      overrideScopes.has(override.scopePath)
    )
      return false;
    overrideScopes.add(override.scopePath);
  }
  const roleCoordinates = new Set<string>();
  for (const role of policy.roles) {
    const coordinate = `${role.scopePath}:${role.roleId}`;
    if (
      !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/u.test(role.roleId) ||
      !(role.scopePath === "." || safeRepositoryPath(role.scopePath, 12)) ||
      !safeDocumentPath(role.path, 12) ||
      !["one", "one_per_package"].includes(role.cardinality) ||
      !["user", "lervo", "provider_adapter"].includes(role.lifecycleOwner) ||
      !["preserve", "reviewed_move", "exact_legacy_alias"].includes(role.relocation) ||
      !["repository_tool", "lervo_exact", "reviewed_exact", "managed_regions"].includes(
        role.rewritePolicy,
      ) ||
      typeof role.required !== "boolean" ||
      (role.legacyAliases !== undefined &&
        (!Array.isArray(role.legacyAliases) ||
          role.legacyAliases.length > 16 ||
          !role.legacyAliases.every((path) => safeDocumentPath(path, 12)))) ||
      roleCoordinates.has(coordinate)
    )
      return false;
    roleCoordinates.add(coordinate);
  }
  return true;
}

function upgradeLegacyTaxonomy(value: unknown): unknown {
  const legacy = value as Record<string, unknown> | null;
  return legacy !== null && typeof legacy === "object" && legacy.schemaVersion === 1
    ? { ...legacy, schemaVersion: 2, documentPolicy: defaultRepositoryDocumentPolicy }
    : value;
}

export function validateDecisionTaxonomy(value: unknown): DecisionTaxonomy {
  const taxonomy = upgradeLegacyTaxonomy(value) as Partial<DecisionTaxonomy> | null;
  const routes = taxonomy?.routes;
  if (
    taxonomy === null ||
    typeof taxonomy !== "object" ||
    taxonomy.schemaVersion !== 2 ||
    typeof taxonomy.taxonomyId !== "string" ||
    !/^[a-z][a-z0-9._-]{2,63}$/u.test(taxonomy.taxonomyId) ||
    !safeRepositoryPath(taxonomy.decisionRoot, 6) ||
    !Array.isArray(taxonomy.legacyRoots) ||
    taxonomy.legacyRoots.length > 8 ||
    !taxonomy.legacyRoots.every((root) => safeRepositoryPath(root, 6)) ||
    new Set(taxonomy.legacyRoots).size !== taxonomy.legacyRoots.length ||
    !Number.isSafeInteger(taxonomy.maxLeafDocuments) ||
    taxonomy.maxLeafDocuments! < 4 ||
    taxonomy.maxLeafDocuments! > 128 ||
    !Array.isArray(routes) ||
    routes.length < 1 ||
    routes.length > 128 ||
    !validateDocumentPolicy(taxonomy.documentPolicy)
  )
    throw new LervoProjectError(
      "contract_invalid",
      ".lervo/knowledge/document-layout.yaml does not satisfy the decision taxonomy contract.",
    );

  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const route of routes) {
    if (
      route === null ||
      typeof route !== "object" ||
      typeof route.id !== "string" ||
      !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(route.id) ||
      !safeRepositoryPath(route.path, 5) ||
      !Number.isSafeInteger(route.priority) ||
      route.priority < 0 ||
      route.priority > 1000 ||
      !Number.isSafeInteger(route.minimumTitleTermMatches) ||
      route.minimumTitleTermMatches < 1 ||
      route.minimumTitleTermMatches > 8 ||
      !Array.isArray(route.titleTerms) ||
      route.titleTerms.length < route.minimumTitleTermMatches ||
      route.titleTerms.length > 64 ||
      !route.titleTerms.every(
        (term) =>
          typeof term === "string" && term.trim() === term && term.length >= 2 && term.length <= 80,
      ) ||
      new Set(route.titleTerms.map((term) => term.toLocaleLowerCase())).size !==
        route.titleTerms.length ||
      ids.has(route.id) ||
      paths.has(route.path)
    )
      throw new LervoProjectError(
        "contract_invalid",
        ".lervo/knowledge/document-layout.yaml does not satisfy the decision taxonomy contract.",
      );
    ids.add(route.id);
    paths.add(route.path);
  }
  return taxonomy as DecisionTaxonomy;
}

export function decisionTaxonomyRequiresUpgrade(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as { schemaVersion?: unknown }).schemaVersion === 1
  );
}

export async function loadDecisionTaxonomy(root: string): Promise<DecisionTaxonomy> {
  const path = resolve(root, ".lervo/knowledge/document-layout.yaml");
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    throw new LervoProjectError(
      "not_initialized",
      `${path} cannot be read. Run lervo init to install the tracked decision taxonomy.`,
    );
  }
  try {
    return validateDecisionTaxonomy(parse(content));
  } catch (error) {
    if (error instanceof LervoProjectError) throw error;
    throw new LervoProjectError("invalid_yaml", `${path} is not valid YAML.`);
  }
}
