import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, stringify } from "yaml";

import { LervoProjectError } from "./types.js";
import {
  decisionTaxonomyIssues,
  type DecisionTaxonomyIssue,
} from "./decision-taxonomy-validation.js";
import {
  defaultRepositoryDocumentPolicy,
  type RepositoryDocumentPolicy,
} from "./repository-document-policy.js";

export interface DecisionTaxonomyRoute {
  id: string;
  path: string;
  priority: number;
  /**
   * The route's semantic scope in prose. A semantic classifier reads it as context; it is never
   * matched as keywords against a document (ADR-0476).
   */
  description: string;
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
      description:
        "Security posture: authentication, authorization, credential handling, privacy, and encryption.",
    },
    {
      id: "data",
      path: "data",
      priority: 90,
      description: "Data models, schemas, storage, persistence, and data migration.",
    },
    {
      id: "architecture",
      path: "architecture",
      priority: 80,
      description:
        "System structure: component boundaries, integrations, protocols, and programming interfaces.",
    },
    {
      id: "product",
      path: "product",
      priority: 70,
      description: "Product scope, user experience, requirements, workflows, and features.",
    },
    {
      id: "delivery",
      path: "delivery",
      priority: 60,
      description:
        "Build, packaging, release, distribution, deployment, and continuous integration.",
    },
    {
      id: "operations",
      path: "operations",
      priority: 50,
      description:
        "Runtime operation: observability, monitoring, diagnostics, incident handling, and recovery.",
    },
    {
      id: "quality",
      path: "quality",
      priority: 40,
      description: "Testing, verification, reliability, performance, and accessibility.",
    },
    {
      id: "development",
      path: "development",
      priority: 30,
      description: "Developer tooling, dependencies, code style, and repository conventions.",
    },
  ],
};

export type {
  DecisionTaxonomyIssue,
  DecisionTaxonomyIssueRule,
} from "./decision-taxonomy-validation.js";

const decisionTaxonomyPath = ".lervo/knowledge/document-layout.yaml";
const maximumMessageIssues = 16;
const maximumRouteDescriptionLength = 512;

export function serializeDecisionTaxonomy(taxonomy = defaultDecisionTaxonomy): string {
  return stringify(taxonomy, { lineWidth: 0 });
}

function upgradeLegacyDocumentPolicy(value: unknown): unknown {
  const legacy = value as Record<string, unknown> | null;
  return legacy !== null && typeof legacy === "object" && legacy.schemaVersion === 1
    ? { ...legacy, schemaVersion: 2, documentPolicy: defaultRepositoryDocumentPolicy }
    : value;
}

/**
 * Legacy routes carried `titleTerms`. They are read only so an existing layout stays valid: the
 * terms become the route's prose scope for the semantic classifier and are never matched again.
 */
function legacyRouteDescription(terms: readonly unknown[]): string {
  let description = "Scope carried from the legacy title terms:";
  let separator = " ";
  for (const term of terms) {
    if (typeof term !== "string") continue;
    const next = `${description}${separator}${term}`;
    if (next.length + 1 > maximumRouteDescriptionLength) break;
    description = next;
    separator = "; ";
  }
  return `${description}.`;
}

function upgradeLegacyRoute(route: unknown): unknown {
  if (route === null || typeof route !== "object" || Array.isArray(route)) return route;
  const value = route as Record<string, unknown>;
  if (!("titleTerms" in value) && !("minimumTitleTermMatches" in value)) return route;
  const { titleTerms, minimumTitleTermMatches: _minimum, ...current } = value;
  return typeof current.description === "string" || !Array.isArray(titleTerms)
    ? current
    : { ...current, description: legacyRouteDescription(titleTerms) };
}

function upgradeLegacyRoutes(value: unknown): unknown {
  const taxonomy = value as Record<string, unknown> | null;
  return taxonomy !== null && typeof taxonomy === "object" && Array.isArray(taxonomy.routes)
    ? { ...taxonomy, routes: taxonomy.routes.map(upgradeLegacyRoute) }
    : value;
}

export class DecisionTaxonomyContractError extends LervoProjectError {
  constructor(readonly issues: readonly DecisionTaxonomyIssue[]) {
    const shown = issues.slice(0, maximumMessageIssues);
    super(
      "contract_invalid",
      [
        `${decisionTaxonomyPath} does not satisfy the decision taxonomy contract (${issues.length} issue(s)).`,
        ...shown.map(
          (issue) =>
            `  [${issue.rule}]${issue.roleId === undefined ? "" : ` role=${issue.roleId}`} ${issue.message}`,
        ),
        ...(issues.length > shown.length
          ? [`  ... ${issues.length - shown.length} more issue(s)`]
          : []),
      ].join("\n"),
    );
    this.name = "DecisionTaxonomyContractError";
  }
}

/** Validates the layout as written, then returns it in the current route contract. */
export function validateDecisionTaxonomy(value: unknown): DecisionTaxonomy {
  const taxonomy = upgradeLegacyDocumentPolicy(value);
  const issues = decisionTaxonomyIssues(taxonomy);
  if (issues.length > 0) throw new DecisionTaxonomyContractError(issues);
  return upgradeLegacyRoutes(taxonomy) as DecisionTaxonomy;
}

function hasLegacyRouteFields(route: unknown): boolean {
  return (
    route !== null &&
    typeof route === "object" &&
    ("titleTerms" in route || "minimumTitleTermMatches" in route)
  );
}

/** A layout written before the current contract: schema 1, or routes that still carry title terms. */
export function decisionTaxonomyRequiresUpgrade(value: unknown): boolean {
  if (value === null || typeof value !== "object") return false;
  const layout = value as { schemaVersion?: unknown; routes?: unknown };
  return (
    layout.schemaVersion === 1 ||
    (Array.isArray(layout.routes) && layout.routes.some(hasLegacyRouteFields))
  );
}

export async function loadDecisionTaxonomy(root: string): Promise<DecisionTaxonomy> {
  const path = resolve(root, decisionTaxonomyPath);
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
