import { basename, posix } from "node:path";

import type { DecisionTaxonomy, DecisionTaxonomyRoute } from "@lervo/project";
import { parse } from "yaml";

export type DocumentLayoutBlockerCode =
  | "ambiguous_document_route"
  | "invalid_document_metadata"
  | "unclassified_document"
  | "unknown_document_route";

export interface DocumentLayoutBlocker {
  code: DocumentLayoutBlockerCode;
  path: string;
  candidateRouteIds?: string[];
}

export interface ClassifiedDocumentDestination {
  toPath: string;
  routeId: string;
  routePath: string;
  group: string;
  subgroup?: string;
  classificationBasis: "explicit_metadata" | "title_terms";
  matchedTitleTerms: string[];
}

export type RepositoryDocumentClassification =
  | { kind: "not_migration_candidate" }
  | { kind: "blocked"; blocker: DocumentLayoutBlocker }
  | { kind: "classified"; destination: ClassifiedDocumentDestination };

export interface RepositoryInstructionRoute {
  paths: string[];
  destination: ClassifiedDocumentDestination;
}

const CONVENTIONAL_ENTRYPOINTS = new Set([
  "CONTRIBUTING.md",
  "SECURITY.md",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "LICENSE.md",
]);

const RESERVED_DOCUMENT_TREES = [
  "architecture",
  "decisions",
  "evidence",
  "instructions",
  "knowledge",
  "product",
  "research",
  "roadmap",
  "specifications",
  "specs",
];

function normalizedWords(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function containsTerm(value: string, term: string): boolean {
  const normalizedValue = ` ${normalizedWords(value)} `;
  const normalizedTerm = normalizedWords(term);
  return normalizedTerm.length > 0 && normalizedValue.includes(` ${normalizedTerm} `);
}

function documentRoot(taxonomy: DecisionTaxonomy): string {
  return posix.dirname(taxonomy.decisionRoot);
}

function alreadyCanonical(path: string, taxonomy: DecisionTaxonomy): boolean {
  const root = documentRoot(taxonomy);
  if (taxonomy.routes.some((route) => path.startsWith(`${root}/${route.path}/`))) return true;
  return RESERVED_DOCUMENT_TREES.some((tree) => path.startsWith(`${root}/${tree}/`));
}

function migrationCandidate(path: string, taxonomy: DecisionTaxonomy): boolean {
  if (!/\.mdx?$/iu.test(path)) return false;
  if (!path.includes("/") && (basename(path) === "README.md" || CONVENTIONAL_ENTRYPOINTS.has(basename(path)))) return false;
  // A README next to a package or subsystem remains its local entrypoint. A
  // README at the documentation root is repository documentation and must be
  // classified like every other legacy document; its basename alone is not a
  // sufficient reason to bypass migration.
  if (basename(path) === "README.md" && posix.dirname(path) !== documentRoot(taxonomy)) return false;
  if (CONVENTIONAL_ENTRYPOINTS.has(basename(path))) return false;
  if (/^(?:\.agents|\.claude|\.codex|\.github)\//u.test(path)) return false;
  return !alreadyCanonical(path, taxonomy);
}

function explicitRoute(content: string): { state: "absent" } | { state: "invalid" } | { state: "present"; routeId: string; filename?: string } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return { state: "absent" };
  const boundary = /\r?\n---\r?\n/gu;
  boundary.lastIndex = content.indexOf("\n") + 1;
  const match = boundary.exec(content);
  if (match === null || match.index > 8192) return { state: "absent" };
  let value: unknown;
  try { value = parse(content.slice(content.indexOf("\n") + 1, match.index)); }
  catch { return { state: "invalid" }; }
  const document = (value as { lervo?: { document?: unknown } } | null)?.lervo?.document as { route?: unknown } | undefined;
  if (document === undefined) return { state: "absent" };
  if (document === null || typeof document !== "object" || typeof document.route !== "string") return { state: "invalid" };
  const filename = (document as { filename?: unknown }).filename;
  if (filename !== undefined && (typeof filename !== "string" || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.mdx?$/u.test(filename))) return { state: "invalid" };
  return { state: "present", routeId: document.route, ...(filename === undefined ? {} : { filename }) };
}

function inferredRoute(value: string, taxonomy: DecisionTaxonomy): { route: DecisionTaxonomyRoute; matchedTerms: string[] } | { candidates: string[] } | null {
  const candidates = taxonomy.routes.flatMap((route) => {
    const matchedTerms = route.titleTerms.filter((term) => containsTerm(value, term));
    return matchedTerms.length >= route.minimumTitleTermMatches ? [{ route, matchedTerms }] : [];
  });
  if (candidates.length === 0) return null;
  const strongest = Math.max(...candidates.map((candidate) => candidate.matchedTerms.length));
  const strongestCandidates = candidates.filter((candidate) => candidate.matchedTerms.length === strongest);
  const highestPriority = Math.max(...strongestCandidates.map((candidate) => candidate.route.priority));
  const finalists = strongestCandidates.filter((candidate) => candidate.route.priority === highestPriority);
  return finalists.length === 1 ? finalists[0]! : { candidates: finalists.map((candidate) => candidate.route.id).sort() };
}

function frontmatterValue(content: string): Record<string, unknown> | null {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return null;
  const match = /\r?\n---\r?\n/gu.exec(content.slice(content.indexOf("\n")));
  if (match === null || match.index > 8192) return null;
  try {
    const value = parse(content.slice(content.indexOf("\n") + 1, content.indexOf("\n") + match.index + 1));
    return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
  } catch { return null; }
}

function instructionPaths(content: string): string[] {
  const value = frontmatterValue(content);
  const raw = value?.paths ?? value?.globs;
  const splitGlobs = (input: string): string[] => {
    const output: string[] = [];
    let start = 0;
    let braces = 0;
    for (let index = 0; index < input.length; index += 1) {
      if (input[index] === "{") braces += 1;
      else if (input[index] === "}") braces = Math.max(0, braces - 1);
      else if (input[index] === "," && braces === 0) {
        output.push(input.slice(start, index));
        start = index + 1;
      }
    }
    output.push(input.slice(start));
    return output;
  };
  const paths = Array.isArray(raw) ? raw : typeof raw === "string" ? splitGlobs(raw) : [];
  return [...new Set(paths.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))].sort();
}

export function repositoryInstructionPaths(content: string): string[] {
  return instructionPaths(content);
}

function fallbackInstructionRoute(path: string, taxonomy: DecisionTaxonomy): DecisionTaxonomyRoute | null {
  const name = basename(path).toLocaleLowerCase();
  const preferredIds = name.startsWith("app-")
    ? ["platform.app", "application", "product"]
    : name.startsWith("web-")
      ? ["platform.web", "web", "architecture"]
      : ["repository", "development", "foundation"];
  for (const id of preferredIds) {
    const exact = taxonomy.routes.find((route) => route.id === id);
    if (exact !== undefined) return exact;
  }
  return null;
}

function preferredInstructionRoute(path: string, taxonomy: DecisionTaxonomy): DecisionTaxonomyRoute | null {
  const name = basename(path, ".md").toLocaleLowerCase();
  const preferredId = /(?:notification|reminder)/u.test(name) ? "platform.notifications"
    : /widget/u.test(name) ? "platform.widgets"
      : /(?:bridge|protocol)/u.test(name) ? "integration.bridge"
        : /(?:supabase|database)/u.test(name) ? "data.supabase"
          : /entit(?:y|ies)/u.test(name) ? "shared.domain"
            : name.startsWith("app-") ? "platform.app"
              : name.startsWith("web-") ? "platform.web"
                : /^(?:code-principles|typescript)$/u.test(name) ? "repository"
                  : null;
  return preferredId === null ? null : taxonomy.routes.find((route) => route.id === preferredId) ?? null;
}

export function classifyClaudeRule(path: string, content: string, taxonomy: DecisionTaxonomy):
  | { kind: "not_migration_candidate" }
  | { kind: "blocked"; blocker: DocumentLayoutBlocker }
  | { kind: "classified"; route: RepositoryInstructionRoute } {
  if (!/(^|\/)\.claude\/rules\/.+\.md$/u.test(path)) return { kind: "not_migration_candidate" };
  const value = frontmatterValue(content);
  const description = typeof value?.description === "string" ? value.description : "";
  const heading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim() ?? "";
  const paths = instructionPaths(content);
  const inferred = inferredRoute(`${basename(path, ".md")} ${description} ${heading} ${paths.join(" ")}`, taxonomy);
  if (inferred !== null && "candidates" in inferred) return { kind: "blocked", blocker: { code: "ambiguous_document_route", path, candidateRouteIds: inferred.candidates } };
  const selected = preferredInstructionRoute(path, taxonomy) ?? inferred?.route ?? fallbackInstructionRoute(path, taxonomy);
  if (selected === null) return { kind: "blocked", blocker: { code: "unclassified_document", path } };
  const [group, ...subgroupParts] = selected.path.split("/");
  return {
    kind: "classified",
    route: {
      paths,
      destination: {
        toPath: `${documentRoot(taxonomy)}/instructions/${selected.path}/${basename(path)}`,
        routeId: selected.id,
        routePath: selected.path,
        group: group!,
        ...(subgroupParts.length === 0 ? {} : { subgroup: subgroupParts.join("/") }),
        classificationBasis: "title_terms",
        matchedTitleTerms: selected === inferred?.route ? inferred.matchedTerms : [],
      },
    },
  };
}

export function classifyRepositoryDocument(path: string, content: string, taxonomy: DecisionTaxonomy): RepositoryDocumentClassification {
  if (!migrationCandidate(path, taxonomy)) return { kind: "not_migration_candidate" };
  const heading = /^#\s+(.+)$/mu.exec(content)?.[1]?.trim() ?? "";
  const classificationText = `${basename(path, posix.extname(path))} ${heading}`;
  const metadata = explicitRoute(content);
  if (metadata.state === "invalid") return { kind: "blocked", blocker: { code: "invalid_document_metadata", path } };

  let route: DecisionTaxonomyRoute;
  let classificationBasis: ClassifiedDocumentDestination["classificationBasis"];
  let matchedTitleTerms: string[];
  if (metadata.state === "present") {
    const selected = taxonomy.routes.find((candidate) => candidate.id === metadata.routeId);
    if (selected === undefined) return { kind: "blocked", blocker: { code: "unknown_document_route", path, candidateRouteIds: [metadata.routeId] } };
    route = selected;
    classificationBasis = "explicit_metadata";
    matchedTitleTerms = [];
  } else {
    const inferred = inferredRoute(classificationText, taxonomy);
    if (inferred === null) return { kind: "blocked", blocker: { code: "unclassified_document", path } };
    if ("candidates" in inferred) return { kind: "blocked", blocker: { code: "ambiguous_document_route", path, candidateRouteIds: inferred.candidates } };
    route = inferred.route;
    classificationBasis = "title_terms";
    matchedTitleTerms = inferred.matchedTerms;
  }

  const [group, ...subgroupParts] = route.path.split("/");
  return {
    kind: "classified",
    destination: {
      toPath: `${documentRoot(taxonomy)}/${route.path}/${metadata.state === "present" && metadata.filename !== undefined ? metadata.filename : basename(path)}`,
      routeId: route.id,
      routePath: route.path,
      group: group!,
      ...(subgroupParts.length === 0 ? {} : { subgroup: subgroupParts.join("/") }),
      classificationBasis,
      matchedTitleTerms,
    },
  };
}
