import { MAX_CONTEXT_SOURCE_BYTES } from "@lervo/context";
import { resolve } from "node:path";

import { loadDecisionTaxonomy, loadProjectManifest } from "@lervo/project";
import {
  archiveScopes,
  historicalDocumentMarker,
  queryTargetsHistory,
} from "./historical-documents.js";
import { analyzeRepositoryKnowledgeImpact } from "./impact.js";
import { assertNoKnowledgeMaterializationTransaction } from "./materialization-owner.js";
import { loadRepositoryKnowledgePolicy } from "./policy.js";
import { readKnowledgeQueryPublications } from "./query-publications.js";
import { readPreparationCache, writePreparationCache } from "./preparation-cache-file.js";
import { SourceUnitCache } from "./source-unit-cache.js";
import { ConceptSidecarCache } from "./concept-sidecar-cache.js";
import { generatedKnowledgePaths } from "./repository-publication-files.js";
import { scanRepositoryKnowledge } from "./scanner.js";
import { observedOnlySource } from "./scan-retention.js";
import { loadStoredClaims, loadStoredConcepts, type StoredClaim } from "./store-reader.js";
import type {
  KnowledgeQueryHit,
  KnowledgeQueryResult,
  PreparedRepositoryKnowledgeQueryRanker,
  RepositoryKnowledgeQueryRanker,
  RepositoryKnowledgeScanOptions,
} from "./types.js";

function terms(value: string): string[] {
  return [
    ...new Set(
      value
        .normalize("NFKC")
        .toLocaleLowerCase()
        .match(/[\p{L}\p{N}]{2,}/gu) ?? [],
    ),
  ];
}

function textTerms(value: string): ReadonlySet<string> {
  return new Set(terms(value));
}

function hasLexicalTerm(values: ReadonlySet<string>, term: string): boolean {
  if (values.has(term)) return true;
  return /^[\uAC00-\uD7A3]{2,}$/u.test(term) && [...values].some((value) => value.startsWith(term));
}

interface PreparedKnowledgeEntry {
  hit: Omit<KnowledgeQueryHit, "score" | "matchedTerms">;
  titleTerms: ReadonlySet<string>;
  pathTerms: ReadonlySet<string>;
  bodyTerms: ReadonlySet<string>;
  searchText: string;
  historical: boolean;
}

interface PreparedKnowledgeQueryData {
  coverage: KnowledgeQueryResult["coverage"];
  skippedForBudget: KnowledgeQueryResult["skippedForBudget"];
  retention: KnowledgeQueryResult["retention"];
  sourceSnapshotId: string;
  impactReportId: string;
  entries: readonly PreparedKnowledgeEntry[];
  ranker?: PreparedRepositoryKnowledgeQueryRanker;
}

const MAXIMUM_PREFERRED_HITS = 5;
const PREFERRED_TIE_DEPTH = 32;

/**
 * Puts the strongest preferred documents first: more named target paths first, then the ranked
 * order, then path. Preferred documents outside the ranked hits join with their own entries.
 */
export function preferHits(
  ranked: readonly KnowledgeQueryHit[],
  preferred: readonly { path: string; weight: number }[],
  entries: readonly PreparedKnowledgeEntry[],
  eligible: (entry: PreparedKnowledgeEntry) => boolean,
  toHit: (entry: PreparedKnowledgeEntry, score: number) => KnowledgeQueryHit,
  limit: number,
): KnowledgeQueryHit[] {
  if (preferred.length === 0) return [...ranked];
  const position = new Map(ranked.map((hit, index) => [hit.path, index] as const));
  const byPath = new Map(entries.filter(eligible).map((entry) => [entry.hit.path, entry] as const));
  const chosen = preferred
    .filter((item) => item.weight > 0 && (position.has(item.path) || byPath.has(item.path)))
    .sort(
      (left, right) =>
        right.weight - left.weight ||
        (position.get(left.path) ?? Number.MAX_SAFE_INTEGER) -
          (position.get(right.path) ?? Number.MAX_SAFE_INTEGER) ||
        (left.path < right.path ? -1 : left.path > right.path ? 1 : 0),
    )
    .slice(0, MAXIMUM_PREFERRED_HITS)
    .map((item) => ranked[position.get(item.path) ?? -1] ?? toHit(byPath.get(item.path)!, 1));
  const first = new Set(chosen.map((hit) => hit.path));
  return [...chosen, ...ranked.filter((hit) => !first.has(hit.path))].slice(0, limit);
}

export class RepositoryKnowledgeQueryIndex {
  private constructor(private readonly data: PreparedKnowledgeQueryData) {}

  static async prepare(input: {
    repositoryRoot: string;
    supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
    sourceUnitFailureMode?: RepositoryKnowledgeScanOptions["sourceUnitFailureMode"];
    ranker?: RepositoryKnowledgeQueryRanker;
    /** Recompute all projections when disabled; source bytes are read freshly in both modes. */
    preparationCache?: "reuse" | "disabled";
  }): Promise<RepositoryKnowledgeQueryIndex> {
    const root = resolve(input.repositoryRoot);
    await assertNoKnowledgeMaterializationTransaction({ repositoryRoot: root });
    const project = await loadProjectManifest(root);
    const policy = await loadRepositoryKnowledgePolicy(root);
    const generated = await generatedKnowledgePaths(root);
    const sourceUnitCache =
      input.preparationCache === "disabled"
        ? undefined
        : new SourceUnitCache(await readPreparationCache(root, "source-units"));
    const scan = await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: project.projectId,
      policy,
      generatedPaths: generated,
      ...(sourceUnitCache === undefined ? {} : { sourceUnitCache }),
      ...(input.sourceUnitFailureMode === undefined
        ? {}
        : { sourceUnitFailureMode: input.sourceUnitFailureMode }),
      ...(input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources }),
    });
    const cacheSnapshot = sourceUnitCache?.snapshot();
    // Unchanged packed units need not stay alive during impact analysis and index construction.
    sourceUnitCache?.release();
    const currentUnits = new Set(scan.units.map((unit) => unit.unitVersionId));
    const impact = await analyzeRepositoryKnowledgeImpact({ repositoryRoot: root, scan });
    const conceptImpact = new Map(
      impact.items
        .filter((item) => item.subjectKind === "concept")
        .map((item) => [item.subjectId, item.freshness]),
    );
    const claimsByConcept = new Map<string, StoredClaim[]>();
    for (const stored of await loadStoredClaims(root)) {
      if (stored.value === null) continue;
      const values = claimsByConcept.get(stored.value.conceptId) ?? [];
      values.push(stored.value);
      claimsByConcept.set(stored.value.conceptId, values);
    }
    const archiveScopePaths = archiveScopes(await loadDecisionTaxonomy(root).catch(() => null));
    const conceptCache =
      input.preparationCache === "disabled"
        ? undefined
        : new ConceptSidecarCache(await readPreparationCache(root, "concept-sidecars"));
    const storedConcepts = await loadStoredConcepts(root, conceptCache);
    const entries: PreparedKnowledgeEntry[] = [];
    // A publication whose source text was not retained is not reread for the query either.
    const skippedPaths = new Set(scan.sources.filter(observedOnlySource).map((s) => s.path));
    const publications = await readKnowledgeQueryPublications(
      root,
      storedConcepts.filter(
        (stored) => stored.value === null || !skippedPaths.has(stored.value.path),
      ),
      Math.min(policy.limits.maxFileBytes, MAX_CONTEXT_SOURCE_BYTES),
    );
    for (const { concept, content, contentHash } of publications) {
      const linkedClaims = claimsByConcept.get(concept.conceptId) ?? [];
      const assurance =
        linkedClaims.length > 0 || concept.assurance === "human_reviewed"
          ? "human_reviewed"
          : "unreviewed";
      // ADR-0544: Lervo-generated concepts cite only whole-file units, which observed-only sources
      // keep, so a missing version is a change. Other concepts may cite inner units that were not
      // extracted, so a missing version is unknown while any source is observed-only.
      const freshness =
        conceptImpact.get(concept.conceptId) ??
        (concept.sourceUnitVersionIds.length === 0
          ? "unknown"
          : concept.sourceUnitVersionIds.every((id) => currentUnits.has(id))
            ? "current"
            : skippedPaths.size > 0 && concept.ownership !== "lervo_generated"
              ? "unknown"
              : "stale");
      const searchText = `${content}\n${linkedClaims.map((claim) => claim.statement).join("\n")}`;
      entries.push({
        hit: {
          conceptId: concept.conceptId,
          title: concept.title,
          path: concept.path,
          ownership: concept.ownership,
          assurance,
          freshness,
          contentHash,
        },
        titleTerms: textTerms(concept.title),
        pathTerms: textTerms(concept.path),
        bodyTerms: textTerms(searchText),
        searchText,
        historical:
          concept.ownership === "user" &&
          historicalDocumentMarker({
            path: concept.path,
            content,
            archiveScopes: archiveScopePaths,
          }) !== null,
      });
    }
    const ranker = await input.ranker?.prepare(
      entries.map((entry) => ({
        conceptId: entry.hit.conceptId,
        title: entry.hit.title,
        path: entry.hit.path,
        contentHash: entry.hit.contentHash,
        labels: [
          entry.hit.ownership,
          entry.hit.assurance,
          entry.hit.freshness,
          ...(entry.historical ? ["historical"] : []),
        ],
        text: entry.searchText,
      })),
      input.preparationCache === "disabled"
        ? undefined
        : {
            previousProjection: await readPreparationCache(root, "ranker"),
          },
    );
    if (cacheSnapshot != null) await writePreparationCache(root, "source-units", cacheSnapshot);
    const conceptSnapshot = conceptCache?.snapshot();
    if (conceptSnapshot != null)
      await writePreparationCache(root, "concept-sidecars", conceptSnapshot);
    if (input.preparationCache !== "disabled" && ranker?.preparationProjection !== undefined)
      await writePreparationCache(root, "ranker", ranker.preparationProjection);
    return new RepositoryKnowledgeQueryIndex({
      coverage: scan.coverage,
      skippedForBudget: scan.skippedForBudget,
      retention: scan.retention,
      sourceSnapshotId: scan.snapshotId,
      impactReportId: impact.reportId,
      entries,
      ...(ranker === undefined ? {} : { ranker }),
    });
  }

  query(input: {
    query: string;
    limit?: number;
    /**
     * ADR-0556: canonical documents that name the task's target paths, weighted by how many they
     * name. Up to five come first, ties in ranked order; the rest of the list keeps its ranking.
     */
    preferred?: readonly { path: string; weight: number }[];
  }): KnowledgeQueryResult {
    const rankedHits: KnowledgeQueryHit[] = [];
    // Preferred documents break ties by a deeper ranked order than the returned page.
    const rankedLimit = Math.max(
      input.limit ?? 20,
      (input.preferred ?? []).length === 0 ? 0 : PREFERRED_TIE_DEPTH,
    );
    const queryTerms = terms(input.query);
    // Historical documents are excluded from default retrieval and labelled when history is asked.
    const includeHistorical = queryTargetsHistory(input.query);
    const eligible = (entry: PreparedKnowledgeEntry): boolean =>
      includeHistorical || !entry.historical;
    const historicalLabel = (entry: PreparedKnowledgeEntry) =>
      entry.historical ? { historical: true as const } : {};
    const toHit = (entry: PreparedKnowledgeEntry, score: number): KnowledgeQueryHit => ({
      ...entry.hit,
      ...historicalLabel(entry),
      score,
      matchedTerms: queryTerms.filter(
        (term) =>
          hasLexicalTerm(entry.titleTerms, term) ||
          hasLexicalTerm(entry.pathTerms, term) ||
          hasLexicalTerm(entry.bodyTerms, term),
      ),
    });
    if (this.data.ranker !== undefined) {
      const byConcept = new Map(this.data.entries.map((entry) => [entry.hit.conceptId, entry]));
      // Withheld documents are excluded inside the ranker, so the limit stays within the
      // engine's bound however many historical documents the repository holds.
      const withheld = new Set(
        this.data.entries.filter((entry) => !eligible(entry)).map((entry) => entry.hit.conceptId),
      );
      const ranked = this.data.ranker.rank({
        query: input.query,
        limit: rankedLimit,
        ...(withheld.size === 0 ? {} : { exclude: withheld }),
      });
      const observed = new Set<string>();
      for (const item of ranked) {
        const entry = byConcept.get(item.conceptId);
        if (
          entry === undefined ||
          observed.has(item.conceptId) ||
          !Number.isSafeInteger(item.score) ||
          item.score <= 0
        ) {
          throw new TypeError("The repository knowledge ranker returned an invalid result.");
        }
        observed.add(item.conceptId);
        if (eligible(entry) && rankedHits.length < rankedLimit)
          rankedHits.push(toHit(entry, item.score));
      }
    } else {
      for (const entry of this.data.entries) {
        if (!eligible(entry)) continue;
        const matchedTerms = queryTerms.filter(
          (term) =>
            hasLexicalTerm(entry.titleTerms, term) ||
            hasLexicalTerm(entry.pathTerms, term) ||
            hasLexicalTerm(entry.bodyTerms, term),
        );
        if (matchedTerms.length === 0) continue;
        const score = matchedTerms.reduce(
          (total, term) =>
            total +
            (hasLexicalTerm(entry.titleTerms, term) ? 8 : 0) +
            (hasLexicalTerm(entry.pathTerms, term) ? 4 : 0) +
            (hasLexicalTerm(entry.bodyTerms, term) ? 1 : 0),
          0,
        );
        rankedHits.push({ ...entry.hit, ...historicalLabel(entry), score, matchedTerms });
      }
    }
    const selectedHits =
      this.data.ranker === undefined
        ? rankedHits
            .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
            .filter((hit) => hit.score >= Math.max(1, Math.ceil((rankedHits[0]?.score ?? 0) / 10)))
            .slice(0, rankedLimit)
        : rankedHits;
    return {
      schemaVersion: 1,
      query: input.query,
      coverage: this.data.coverage,
      skippedForBudget: this.data.skippedForBudget,
      retention: this.data.retention,
      semantics: "recommended",
      ...(this.data.ranker === undefined
        ? {}
        : {
            ranking: {
              engine: { ...this.data.ranker.engine },
              adapterBuildId: this.data.ranker.adapterBuildId,
            },
          }),
      sourceSnapshotId: this.data.sourceSnapshotId,
      impactReportId: this.data.impactReportId,
      hits: preferHits(
        selectedHits,
        input.preferred ?? [],
        this.data.entries,
        eligible,
        toHit,
        input.limit ?? 20,
      ),
    };
  }
}

export async function queryRepositoryKnowledge(input: {
  repositoryRoot: string;
  query: string;
  limit?: number;
  preferred?: readonly { path: string; weight: number }[];
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  ranker?: RepositoryKnowledgeQueryRanker;
}): Promise<KnowledgeQueryResult> {
  const index = await RepositoryKnowledgeQueryIndex.prepare({
    repositoryRoot: input.repositoryRoot,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
    ...(input.ranker === undefined ? {} : { ranker: input.ranker }),
  });
  return index.query({
    query: input.query,
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.preferred === undefined ? {} : { preferred: input.preferred }),
  });
}
