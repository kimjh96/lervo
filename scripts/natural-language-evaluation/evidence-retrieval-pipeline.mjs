import { posix } from "node:path";

import { lexicalTermCoverage, selectSectionEvidence } from "./section-evidence-selector.mjs";

const defaultAnchorLimit = 3;
const defaultLinkedExpansionLimit = 2;
const defaultFocusedExpansionLimit = 1;
const defaultMinimumFocusedTermCoverage = 3;
const historicalRationalePattern = /(?:\bwhy\b|\brationale\b|왜|이유|예전에)/iu;
const canonicalCurrentPrefixes = [
  "docs/specifications/",
  "docs/specs/",
  "docs/foundation/",
  "docs/distribution/",
  "docs/roadmap/",
];

function sourceRole(path) {
  if (path === "README.md" || path === "AGENTS.md") return "canonical_current";
  if (canonicalCurrentPrefixes.some((prefix) => path.startsWith(prefix))) {
    return "canonical_current";
  }
  if (path.startsWith("docs/decisions/")) return "historical_decision";
  return "supporting_evidence";
}

export function prioritizeCanonicalEvidence(sources, query) {
  const historical = historicalRationalePattern.test(query);
  const priority = historical
    ? { historical_decision: 0, canonical_current: 1, supporting_evidence: 2 }
    : { canonical_current: 0, historical_decision: 1, supporting_evidence: 2 };
  return sources
    .map((source, rank) => ({
      source,
      rank,
      role: sourceRole(source.path),
      priority: priority[sourceRole(source.path)],
      queryAlignment:
        sourceRole(source.path) === "canonical_current"
          ? selectSectionEvidence(source, query).selectionScore
          : 0,
    }))
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        right.queryAlignment - left.queryAlignment ||
        left.rank - right.rank,
    )
    .map((item) => item.source);
}

function linkedPaths(source) {
  const directory = posix.dirname(source.path);
  return [...source.text.matchAll(/\[[^\]]*\]\(([^)]+)\)/gu)]
    .map((match) => match[1].split("#", 1)[0])
    .filter((target) => target.length > 0 && !/^[a-z]+:/iu.test(target))
    .map((target) => posix.normalize(posix.join(directory, decodeURIComponent(target))));
}

export function selectEvidenceRecommendations(rankedSources, query, sourceByPath, options = {}) {
  const anchorLimit = options.anchorLimit ?? defaultAnchorLimit;
  const linkedExpansionLimit = options.linkedExpansionLimit ?? defaultLinkedExpansionLimit;
  const focusedExpansionLimit = options.focusedExpansionLimit ?? defaultFocusedExpansionLimit;
  const minimumFocusedTermCoverage =
    options.minimumFocusedTermCoverage ?? defaultMinimumFocusedTermCoverage;
  const selected = rankedSources.slice(0, anchorLimit);
  const selectedPaths = new Set(selected.map((source) => source.path));
  const linked = [];
  for (const source of selected) {
    for (const path of linkedPaths(source)) {
      const candidate = sourceByPath.get(path);
      if (candidate === undefined || selectedPaths.has(path)) continue;
      selectedPaths.add(path);
      linked.push(candidate);
      if (linked.length >= linkedExpansionLimit) break;
    }
    if (linked.length >= linkedExpansionLimit) break;
  }
  const focused = rankedSources
    .slice(anchorLimit)
    .filter(
      (source) => !selectedPaths.has(source.path) && source.path.startsWith("docs/specifications/"),
    )
    .map((source, index) => ({
      source,
      rank: index + anchorLimit + 1,
      score: selectSectionEvidence(source, query).selectionScore,
      documentTermCoverage: lexicalTermCoverage(source.text, query),
    }))
    .filter(
      (item) =>
        item.documentTermCoverage >= minimumFocusedTermCoverage &&
        Math.floor(item.score / 100_000) >= minimumFocusedTermCoverage,
    )
    .sort((left, right) => right.score - left.score || left.rank - right.rank)
    .slice(0, focusedExpansionLimit)
    .map((item) => item.source);
  const ordered = options.linkedExpansionBeforeSecondaryAnchors
    ? [selected[0], ...linked, ...selected.slice(1), ...focused].filter(Boolean)
    : [...selected, ...linked, ...focused];
  return prioritizeCanonicalEvidence(ordered, query);
}
