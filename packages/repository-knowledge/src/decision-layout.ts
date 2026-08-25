import type { DecisionTaxonomy, DecisionTaxonomyRoute } from "@lervo/project";
import { parse } from "yaml";

export type DecisionLayoutBlockerCode =
  | "ambiguous_decision_route"
  | "decision_leaf_overflow"
  | "invalid_decision_heading"
  | "invalid_decision_metadata"
  | "legacy_decision_layout"
  | "unclassified_decision"
  | "unknown_decision_route";

export interface DecisionLayoutBlocker {
  code: DecisionLayoutBlockerCode;
  path: string;
  candidateRouteIds?: string[];
  configuredMaximum?: number;
  observedCount?: number;
}

export interface ClassifiedDecisionDestination {
  toPath: string;
  routeId: string;
  routePath: string;
  group: string;
  subgroup?: string;
  classificationBasis: "explicit_metadata" | "title_terms";
  matchedTitleTerms: string[];
}

export type FlatDecisionClassification =
  | { kind: "not_flat_decision" }
  | { kind: "blocked"; blocker: DecisionLayoutBlocker }
  | { kind: "classified"; destination: ClassifiedDecisionDestination };

function normalizedWords(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

function containsTerm(title: string, term: string): boolean {
  const normalizedTitle = ` ${normalizedWords(title)} `;
  const normalizedTerm = normalizedWords(term);
  return normalizedTerm.length > 0 && normalizedTitle.includes(` ${normalizedTerm} `);
}

function flatDecisionName(path: string, taxonomy: DecisionTaxonomy): string | null {
  for (const root of [taxonomy.decisionRoot, ...taxonomy.legacyRoots]) {
    const prefix = `${root}/`;
    if (!path.startsWith(prefix)) continue;
    const name = path.slice(prefix.length);
    return !name.includes("/") && /^\d{4}-.+\.md$/u.test(name) ? name : null;
  }
  return null;
}

function explicitRoute(
  content: string,
):
  | { state: "absent" }
  | { state: "invalid" }
  | { state: "present"; taxonomyId?: string; routeId: string } {
  if (!content.startsWith("---\n") && !content.startsWith("---\r\n")) return { state: "absent" };
  const boundary = /\r?\n---\r?\n/gu;
  boundary.lastIndex = content.indexOf("\n") + 1;
  const match = boundary.exec(content);
  if (match === null || match.index > 8192) return { state: "absent" };
  let value: unknown;
  try {
    value = parse(content.slice(content.indexOf("\n") + 1, match.index));
  } catch {
    return { state: "invalid" };
  }
  const decision = (value as { lervo?: { decision?: unknown } } | null)?.lervo?.decision as
    { taxonomy?: unknown; route?: unknown } | undefined;
  if (decision === undefined) return { state: "absent" };
  if (
    decision === null ||
    typeof decision !== "object" ||
    typeof decision.route !== "string" ||
    (decision.taxonomy !== undefined && typeof decision.taxonomy !== "string")
  )
    return { state: "invalid" };
  return {
    state: "present",
    ...(decision.taxonomy === undefined ? {} : { taxonomyId: decision.taxonomy }),
    routeId: decision.route,
  };
}

function inferredRoute(
  title: string,
  taxonomy: DecisionTaxonomy,
): { route: DecisionTaxonomyRoute; matchedTerms: string[] } | { candidates: string[] } | null {
  const candidates = taxonomy.routes.flatMap((route) => {
    const matchedTerms = route.titleTerms.filter((term) => containsTerm(title, term));
    return matchedTerms.length >= route.minimumTitleTermMatches ? [{ route, matchedTerms }] : [];
  });
  if (candidates.length === 0) return null;
  const highestPriority = Math.max(...candidates.map((candidate) => candidate.route.priority));
  const prioritized = candidates.filter(
    (candidate) => candidate.route.priority === highestPriority,
  );
  const strongest = Math.max(...prioritized.map((candidate) => candidate.matchedTerms.length));
  const finalists = prioritized.filter((candidate) => candidate.matchedTerms.length === strongest);
  return finalists.length === 1
    ? finalists[0]!
    : { candidates: finalists.map((candidate) => candidate.route.id).sort() };
}

export function classifyFlatDecision(
  path: string,
  content: string,
  taxonomy: DecisionTaxonomy,
): FlatDecisionClassification {
  const name = flatDecisionName(path, taxonomy);
  if (name === null) return { kind: "not_flat_decision" };
  const heading = /^#\s+ADR-\d{4}:\s+(.+)$/mu.exec(content)?.[1]?.trim();
  if (heading === undefined || heading.length === 0)
    return { kind: "blocked", blocker: { code: "invalid_decision_heading", path } };
  const metadata = explicitRoute(content);
  if (
    metadata.state === "invalid" ||
    (metadata.state === "present" &&
      metadata.taxonomyId !== undefined &&
      metadata.taxonomyId !== taxonomy.taxonomyId)
  ) {
    return { kind: "blocked", blocker: { code: "invalid_decision_metadata", path } };
  }
  let route: DecisionTaxonomyRoute;
  let classificationBasis: ClassifiedDecisionDestination["classificationBasis"];
  let matchedTitleTerms: string[];
  if (metadata.state === "present") {
    const selected = taxonomy.routes.find((candidate) => candidate.id === metadata.routeId);
    if (selected === undefined)
      return {
        kind: "blocked",
        blocker: { code: "unknown_decision_route", path, candidateRouteIds: [metadata.routeId] },
      };
    route = selected;
    classificationBasis = "explicit_metadata";
    matchedTitleTerms = [];
  } else {
    const inferred = inferredRoute(heading, taxonomy);
    if (inferred === null)
      return { kind: "blocked", blocker: { code: "unclassified_decision", path } };
    if ("candidates" in inferred)
      return {
        kind: "blocked",
        blocker: { code: "ambiguous_decision_route", path, candidateRouteIds: inferred.candidates },
      };
    route = inferred.route;
    classificationBasis = "title_terms";
    matchedTitleTerms = inferred.matchedTerms;
  }
  const [group, ...subgroupParts] = route.path.split("/");
  return {
    kind: "classified",
    destination: {
      toPath: `${taxonomy.decisionRoot}/${route.path}/${name}`,
      routeId: route.id,
      routePath: route.path,
      group: group!,
      ...(subgroupParts.length === 0 ? {} : { subgroup: subgroupParts.join("/") }),
      classificationBasis,
      matchedTitleTerms,
    },
  };
}

export function inspectGroupedDecisionPaths(
  paths: readonly string[],
  taxonomy: DecisionTaxonomy,
): DecisionLayoutBlocker[] {
  const blockers: DecisionLayoutBlocker[] = [];
  const routeCounts = new Map<string, number>();
  const routeByPath = new Map(taxonomy.routes.map((route) => [route.path, route]));
  for (const path of paths.filter((item) => /(?:^|\/)\d{4}-.+\.md$/u.test(item)).sort()) {
    const canonicalPrefix = `${taxonomy.decisionRoot}/`;
    if (path.startsWith(canonicalPrefix)) {
      const suffix = path.slice(canonicalPrefix.length);
      const parent = suffix.slice(0, suffix.lastIndexOf("/"));
      if (parent.length === 0) continue;
      const route = routeByPath.get(parent);
      if (route === undefined) blockers.push({ code: "unknown_decision_route", path });
      else routeCounts.set(route.id, (routeCounts.get(route.id) ?? 0) + 1);
      continue;
    }
    for (const legacyRoot of taxonomy.legacyRoots) {
      if (path.startsWith(`${legacyRoot}/`) && path.slice(legacyRoot.length + 1).includes("/"))
        blockers.push({ code: "legacy_decision_layout", path });
    }
  }
  for (const route of taxonomy.routes) {
    const count = routeCounts.get(route.id) ?? 0;
    if (count > taxonomy.maxLeafDocuments)
      blockers.push({
        code: "decision_leaf_overflow",
        path: `${taxonomy.decisionRoot}/${route.path}`,
        configuredMaximum: taxonomy.maxLeafDocuments,
        observedCount: count,
      });
  }
  return blockers;
}
