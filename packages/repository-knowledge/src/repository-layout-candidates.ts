import { basename } from "node:path";

import type { DecisionTaxonomy } from "@lervo/project";

import {
  observeApplicationContent,
  owningWorkspacePackage,
  workspacePackageRoots,
} from "./application-content-evidence.js";
import { classifyFlatDecision } from "./decision-layout.js";
import { repositoryDocumentationRoot, structuralMigrationCandidate } from "./document-layout.js";
import { loadDocumentRouteClassifications } from "./document-route-classification-store.js";
import type {
  DeferredDocumentRoute,
  DocumentRouteEvidence,
  DocumentRouteResolutionContext,
  RetainedDocumentPlacement,
} from "./document-route-resolution.js";
import type { DocumentToolOwnershipEvidence } from "./document-tool-ownership.js";
import { observeToolGeneratedDocuments } from "./document-tool-ownership-observation.js";
import { sha256 } from "./integrity.js";
import {
  classifyRepositoryLayoutSource,
  includedRepositorySource,
  type RepositoryLayoutCandidate,
  type RepositoryLayoutSourceOutcome,
} from "./repository-layout-source-classification.js";
import { loadDocumentMoveLineages } from "./source-lineage.js";
import type { RepositoryKnowledgeScan } from "./types.js";

export type {
  RepositoryLayoutCandidate,
  RepositoryLayoutClassification,
  RepositoryLayoutReason,
} from "./repository-layout-source-classification.js";

export interface RepositoryLayoutClassificationBlocker {
  code: Extract<RepositoryLayoutSourceOutcome, { kind: "blocked" }>["blocker"]["code"];
  path: string;
  pathDigest: string;
  candidateRouteIds?: string[];
}

/** Retained placements, including documents a repository tool owns (ADR-0473 evidence). */
export type RepositoryLayoutRetainedDocument =
  | RetainedDocumentPlacement
  | { path: string; basis: "tool_owned"; evidence: DocumentToolOwnershipEvidence[] };

/** A deferred document with the workspace package that holds it, the classifier's context. */
export interface RepositoryLayoutDeferredDocument extends DeferredDocumentRoute {
  workspacePackage: string | null;
}

export interface RepositoryLayoutCandidates {
  candidates: RepositoryLayoutCandidate[];
  blockers: RepositoryLayoutClassificationBlocker[];
  /** Flat decisions under retired routes whose re-placement this plan carries or defers. */
  repairableDecisionPaths: Set<string>;
  deferredDocuments: RepositoryLayoutDeferredDocument[];
  deferredDocumentCount: number;
  retainedDocuments: RepositoryLayoutRetainedDocument[];
  retainedDocumentCount: number;
  /** Every recorded classification this plan relies on or waits for; the rest may be pruned. */
  liveClassificationIds: Set<string>;
}

/**
 * Lineage-backed decisions under a retired route, or the removed default `foundation` fallback,
 * are placed again from their identity path when semantic evidence exists. Without it, only a
 * decision under a retired route defers; one under an allowed route stays where it is.
 */
async function lineageRepairs(input: {
  root: string;
  scan: RepositoryKnowledgeScan;
  taxonomy: DecisionTaxonomy;
  evidence: DocumentRouteEvidence;
}): Promise<{
  candidates: RepositoryLayoutCandidate[];
  deferred: DeferredDocumentRoute[];
  paths: Set<string>;
}> {
  const { taxonomy } = input;
  const lineage = await loadDocumentMoveLineages({
    repositoryRoot: input.root,
    projectId: input.scan.projectId,
  });
  const sources = new Map(
    input.scan.sources.flatMap((source) => {
      const included = includedRepositorySource(source);
      return included === null ? [] : [[source.path, included] as const];
    }),
  );
  const allowedRoutePaths = new Set(taxonomy.routes.map((route) => route.path));
  const candidates: RepositoryLayoutCandidate[] = [];
  const deferred: DeferredDocumentRoute[] = [];
  const paths = new Set<string>();
  for (const record of lineage.records.filter((item) => item.activeTerminal)) {
    const name = basename(record.value.toPath);
    const cameFromLegacyFlatRoot = taxonomy.legacyRoots.some(
      (legacyRoot) => record.value.identityPath === `${legacyRoot}/${name}`,
    );
    const canonicalPrefix = `${taxonomy.decisionRoot}/`;
    if (!cameFromLegacyFlatRoot || !record.value.toPath.startsWith(canonicalPrefix)) continue;
    const relativeDestination = record.value.toPath.slice(canonicalPrefix.length);
    const currentRoutePath = relativeDestination.slice(0, relativeDestination.lastIndexOf("/"));
    const isRetiredRoute = !allowedRoutePaths.has(currentRoutePath);
    const isPreviousDefaultFallback =
      taxonomy.taxonomyId === "decisions.default" && currentRoutePath === "foundation";
    if (!isRetiredRoute && !isPreviousDefaultFallback) continue;
    const source = sources.get(record.value.toPath);
    if (source === undefined) continue;
    const reclassified = classifyFlatDecision(
      record.value.identityPath,
      source.content,
      taxonomy,
      input.evidence,
      source.path,
    );
    // A decision under a still-allowed route is validly placed; only a retired route must wait.
    if (reclassified.kind === "deferred") {
      if (!isRetiredRoute) continue;
      deferred.push(reclassified.deferral);
      paths.add(source.path);
      continue;
    }
    if (reclassified.kind !== "classified" || reclassified.destination.toPath === source.path)
      continue;
    candidates.push({
      source,
      ...reclassified.destination,
      classification: "decision",
      reason: "recognized_decision_document",
    });
    paths.add(source.path);
  }
  return { candidates, deferred, paths };
}

/** Repository-tool ownership keeps a document in place; only unresolved candidates are probed. */
async function toolOwnedCandidates(
  root: string,
  taxonomy: DecisionTaxonomy,
  outcomes: ReadonlyMap<string, RepositoryLayoutSourceOutcome>,
): Promise<Map<string, DocumentToolOwnershipEvidence[]>> {
  const paths = [...outcomes]
    .filter(
      ([, outcome]) =>
        (outcome.kind === "deferred" && outcome.deferral.subject === "document") ||
        (outcome.kind === "candidate" &&
          outcome.candidate.classification === "document" &&
          outcome.candidate.classificationBasis === "semantic_provider"),
    )
    .map(([path]) => path);
  return paths.length === 0
    ? new Map()
    : observeToolGeneratedDocuments({
        repositoryRoot: root,
        paths,
        roles: taxonomy.documentPolicy.roles,
      });
}

/**
 * Classifies every scanned source for one layout plan: what moves, what blocks, what defers to
 * semantic classification, and what stays in place with the evidence that keeps it there.
 */
export async function classifyRepositoryLayoutCandidates(input: {
  root: string;
  scan: RepositoryKnowledgeScan;
  taxonomy: DecisionTaxonomy;
  documentRouteContext?: DocumentRouteResolutionContext;
}): Promise<RepositoryLayoutCandidates> {
  const { root, scan, taxonomy } = input;
  const included = scan.sources.flatMap((source) => {
    const item = includedRepositorySource(source);
    return item === null ? [] : [item];
  });
  const evidence: DocumentRouteEvidence = {
    classifications: await loadDocumentRouteClassifications(root),
    applicationContent: observeApplicationContent({
      sources: scan.sources,
      documentPaths: included
        .filter(
          (source) =>
            source.kind === "documentation" && structuralMigrationCandidate(source.path, taxonomy),
        )
        .map((source) => source.path),
      documentationRoot: repositoryDocumentationRoot(taxonomy),
    }),
  };
  const existingPaths = new Set(scan.sources.map((source) => source.path));
  const outcomes = new Map(
    included.map(
      (source) =>
        [
          source.path,
          classifyRepositoryLayoutSource(source, taxonomy, evidence, existingPaths),
        ] as const,
    ),
  );
  const toolOwned = await toolOwnedCandidates(root, taxonomy, outcomes);
  const candidates: RepositoryLayoutCandidate[] = [];
  const blockers: RepositoryLayoutClassificationBlocker[] = [];
  const deferred: DeferredDocumentRoute[] = [];
  const retained: RepositoryLayoutRetainedDocument[] = [];
  for (const [path, outcome] of outcomes) {
    const ownership = toolOwned.get(path);
    if (ownership !== undefined) {
      retained.push({ path, basis: "tool_owned", evidence: ownership });
      continue;
    }
    if (outcome.kind === "candidate") candidates.push(outcome.candidate);
    else if (outcome.kind === "blocked")
      blockers.push({ ...outcome.blocker, pathDigest: sha256(outcome.blocker.path) });
    else if (outcome.kind === "deferred") deferred.push(outcome.deferral);
    else if (outcome.kind === "retained") retained.push(outcome.retained);
  }
  const repairs = await lineageRepairs({ root, scan, taxonomy, evidence });
  candidates.push(...repairs.candidates);
  deferred.push(...repairs.deferred);
  candidates.sort((left, right) => left.source.path.localeCompare(right.source.path));
  deferred.sort((left, right) => left.path.localeCompare(right.path));
  retained.sort((left, right) => left.path.localeCompare(right.path));
  const liveClassificationIds = new Set([
    ...deferred.map((item) => item.classificationId),
    ...candidates.flatMap((item) => item.semanticClassification?.classificationId ?? []),
    ...retained.flatMap((item) =>
      item.basis === "semantic_provider" ? [item.semanticClassification.classificationId] : [],
    ),
  ]);
  const packages = workspacePackageRoots(scan.sources);
  return {
    candidates,
    blockers,
    repairableDecisionPaths: repairs.paths,
    liveClassificationIds,
    deferredDocuments: deferred.map((item) => ({
      ...item,
      resolution:
        item.reason === "destination_conflict"
          ? "destination_conflict"
          : item.reason === "semantic_classification_uncertain"
            ? "route_metadata"
            : !input.documentRouteContext?.providerAvailable
              ? "provider_unavailable"
              : input.documentRouteContext.normalizationRoots.some(
                    (root) => item.path === root || item.path.startsWith(`${root}/`),
                  )
                ? "background_classification"
                : "delegation_scope",
      workspacePackage: owningWorkspacePackage(item.path, packages),
    })),
    deferredDocumentCount: deferred.length,
    retainedDocuments: retained,
    retainedDocumentCount: retained.length,
  };
}
