import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse, stringify } from "yaml";

import { LervoProjectError } from "./types.js";

export interface DecisionTaxonomyRoute {
  id: string;
  path: string;
  priority: number;
  minimumTitleTermMatches: number;
  titleTerms: string[];
}

export interface DecisionTaxonomy {
  schemaVersion: 1;
  taxonomyId: string;
  decisionRoot: string;
  legacyRoots: string[];
  maxLeafDocuments: number;
  routes: DecisionTaxonomyRoute[];
}

export const defaultDecisionTaxonomy: DecisionTaxonomy = {
  schemaVersion: 1,
  taxonomyId: "decisions.default",
  decisionRoot: "docs/decisions",
  legacyRoots: ["docs/adr"],
  maxLeafDocuments: 24,
  routes: [
    { id: "security", path: "security", priority: 100, minimumTitleTermMatches: 1, titleTerms: ["security", "authentication", "authorization", "credential", "privacy", "encryption"] },
    { id: "data", path: "data", priority: 90, minimumTitleTermMatches: 1, titleTerms: ["data", "database", "schema", "storage", "persistence", "migration"] },
    { id: "architecture", path: "architecture", priority: 80, minimumTitleTermMatches: 1, titleTerms: ["architecture", "system boundary", "component", "integration", "protocol", "api"] },
    { id: "product", path: "product", priority: 70, minimumTitleTermMatches: 1, titleTerms: ["product", "user experience", "requirement", "scope", "workflow", "feature"] },
    { id: "delivery", path: "delivery", priority: 60, minimumTitleTermMatches: 1, titleTerms: ["release", "deployment", "deploy", "distribution", "packaging", "build", "continuous integration"] },
    { id: "operations", path: "operations", priority: 50, minimumTitleTermMatches: 1, titleTerms: ["runtime", "operations", "observability", "monitoring", "doctor", "diagnostic", "incident", "recovery"] },
    { id: "quality", path: "quality", priority: 40, minimumTitleTermMatches: 1, titleTerms: ["testing", "verification", "quality", "reliability", "performance", "accessibility"] },
    { id: "development", path: "development", priority: 30, minimumTitleTermMatches: 1, titleTerms: ["developer tooling", "dependency", "code style", "repository", "monorepo"] },
  ],
};

export function serializeDecisionTaxonomy(taxonomy = defaultDecisionTaxonomy): string {
  return stringify(taxonomy, { lineWidth: 0 });
}

function safeRepositoryPath(value: unknown, maximumSegments: number): value is string {
  if (typeof value !== "string" || value.length < 1 || value.length > 160 || value.startsWith("/") || value.endsWith("/")) return false;
  const segments = value.split("/");
  return segments.length <= maximumSegments && segments.every((segment) => /^[a-z0-9][a-z0-9._-]*$/u.test(segment) && segment !== "." && segment !== "..");
}

export function validateDecisionTaxonomy(value: unknown): DecisionTaxonomy {
  const taxonomy = value as Partial<DecisionTaxonomy> | null;
  const routes = taxonomy?.routes;
  if (
    taxonomy === null || typeof taxonomy !== "object" || taxonomy.schemaVersion !== 1 ||
    typeof taxonomy.taxonomyId !== "string" || !/^[a-z][a-z0-9._-]{2,63}$/u.test(taxonomy.taxonomyId) ||
    !safeRepositoryPath(taxonomy.decisionRoot, 6) || !Array.isArray(taxonomy.legacyRoots) || taxonomy.legacyRoots.length > 8 ||
    !taxonomy.legacyRoots.every((root) => safeRepositoryPath(root, 6)) || new Set(taxonomy.legacyRoots).size !== taxonomy.legacyRoots.length ||
    !Number.isSafeInteger(taxonomy.maxLeafDocuments) || taxonomy.maxLeafDocuments! < 4 || taxonomy.maxLeafDocuments! > 128 ||
    !Array.isArray(routes) || routes.length < 1 || routes.length > 128
  ) throw new LervoProjectError("contract_invalid", ".lervo/knowledge/document-layout.yaml does not satisfy the decision taxonomy contract.");

  const ids = new Set<string>();
  const paths = new Set<string>();
  for (const route of routes) {
    if (
      route === null || typeof route !== "object" || typeof route.id !== "string" || !/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u.test(route.id) ||
      !safeRepositoryPath(route.path, 5) || !Number.isSafeInteger(route.priority) || route.priority < 0 || route.priority > 1000 ||
      !Number.isSafeInteger(route.minimumTitleTermMatches) || route.minimumTitleTermMatches < 1 || route.minimumTitleTermMatches > 8 ||
      !Array.isArray(route.titleTerms) || route.titleTerms.length < route.minimumTitleTermMatches || route.titleTerms.length > 64 ||
      !route.titleTerms.every((term) => typeof term === "string" && term.trim() === term && term.length >= 2 && term.length <= 80) ||
      new Set(route.titleTerms.map((term) => term.toLocaleLowerCase())).size !== route.titleTerms.length || ids.has(route.id) || paths.has(route.path)
    ) throw new LervoProjectError("contract_invalid", ".lervo/knowledge/document-layout.yaml does not satisfy the decision taxonomy contract.");
    ids.add(route.id);
    paths.add(route.path);
  }
  return taxonomy as DecisionTaxonomy;
}

export async function loadDecisionTaxonomy(root: string): Promise<DecisionTaxonomy> {
  const path = resolve(root, ".lervo/knowledge/document-layout.yaml");
  let content: string;
  try { content = await readFile(path, "utf8"); }
  catch { throw new LervoProjectError("not_initialized", `${path} cannot be read. Run lervo init to install the tracked decision taxonomy.`); }
  try { return validateDecisionTaxonomy(parse(content)); }
  catch (error) {
    if (error instanceof LervoProjectError) throw error;
    throw new LervoProjectError("invalid_yaml", `${path} is not valid YAML.`);
  }
}
