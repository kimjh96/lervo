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

export type {
  DecisionTaxonomyIssue,
  DecisionTaxonomyIssueRule,
} from "./decision-taxonomy-validation.js";

const decisionTaxonomyPath = ".lervo/knowledge/document-layout.yaml";
const maximumMessageIssues = 16;

export function serializeDecisionTaxonomy(taxonomy = defaultDecisionTaxonomy): string {
  return stringify(taxonomy, { lineWidth: 0 });
}

function upgradeLegacyTaxonomy(value: unknown): unknown {
  const legacy = value as Record<string, unknown> | null;
  return legacy !== null && typeof legacy === "object" && legacy.schemaVersion === 1
    ? { ...legacy, schemaVersion: 2, documentPolicy: defaultRepositoryDocumentPolicy }
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

export function validateDecisionTaxonomy(value: unknown): DecisionTaxonomy {
  const taxonomy = upgradeLegacyTaxonomy(value);
  const issues = decisionTaxonomyIssues(taxonomy);
  if (issues.length > 0) throw new DecisionTaxonomyContractError(issues);
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
