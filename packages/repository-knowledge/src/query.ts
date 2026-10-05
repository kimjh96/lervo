import { resolve } from "node:path";

import { loadDecisionTaxonomy, loadProjectManifest } from "@lervo/project";
import type { DocumentRegistry } from "@lervo/schemas";
import {
  archiveScopes,
  historicalDocumentMarker,
  queryTargetsHistory,
} from "./historical-documents.js";
import { analyzeRepositoryKnowledgeImpact } from "./impact.js";
import { assertNoKnowledgeMaterializationTransaction } from "./durable-apply.js";
import { sha256 } from "./integrity.js";
import { loadRepositoryKnowledgePolicy } from "./policy.js";
import { generatedKnowledgePaths, readSafePublication } from "./repository-publication-files.js";
import { projectKnowledgeRelations, type RelationConceptCoordinate } from "./relation-query.js";
import { scanRepositoryKnowledge } from "./scanner.js";
import {
  loadStoredClaims,
  loadStoredConcepts,
  loadStoredRelations,
  type StoredClaim,
} from "./store-reader.js";
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
  sourceSnapshotId: string;
  impactReportId: string;
  conceptSidecarSetHash: string;
  relationSidecarSetHash: string;
  entries: readonly PreparedKnowledgeEntry[];
  concepts: readonly RelationConceptCoordinate[];
  relations: Awaited<ReturnType<typeof loadStoredRelations>>;
  ranker?: PreparedRepositoryKnowledgeQueryRanker;
}

export class RepositoryKnowledgeQueryIndex {
  private constructor(private readonly data: PreparedKnowledgeQueryData) {}

  static async prepare(input: {
    repositoryRoot: string;
    supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
    sourceUnitFailureMode?: RepositoryKnowledgeScanOptions["sourceUnitFailureMode"];
    ranker?: RepositoryKnowledgeQueryRanker;
  }): Promise<RepositoryKnowledgeQueryIndex> {
    const root = resolve(input.repositoryRoot);
    await assertNoKnowledgeMaterializationTransaction({ repositoryRoot: root });
    const project = await loadProjectManifest(root);
    const policy = await loadRepositoryKnowledgePolicy(root);
    const generated = await generatedKnowledgePaths(root);
    const scan = await scanRepositoryKnowledge({
      repositoryRoot: root,
      projectId: project.projectId,
      policy,
      generatedPaths: generated,
      ...(input.sourceUnitFailureMode === undefined
        ? {}
        : { sourceUnitFailureMode: input.sourceUnitFailureMode }),
      ...(input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources }),
    });
    const currentUnits = new Set(scan.units.map((unit) => unit.unitVersionId));
    const impact = await analyzeRepositoryKnowledgeImpact({ repositoryRoot: root, scan });
    const conceptImpact = new Map(
      impact.items
        .filter((item) => item.subjectKind === "concept")
        .map((item) => [item.subjectId, item.freshness]),
    );
    const resolvedConcepts: RelationConceptCoordinate[] = [];
    const claimsByConcept = new Map<string, StoredClaim[]>();
    for (const stored of await loadStoredClaims(root)) {
      if (stored.value === null) continue;
      const values = claimsByConcept.get(stored.value.conceptId) ?? [];
      values.push(stored.value);
      claimsByConcept.set(stored.value.conceptId, values);
    }
    const archiveScopePaths = archiveScopes(await loadDecisionTaxonomy(root).catch(() => null));
    const storedConcepts = await loadStoredConcepts(root);
    const storedRelations = await loadStoredRelations(root);
    const entries: PreparedKnowledgeEntry[] = [];
    for (const stored of storedConcepts) {
      const concept = stored.value;
      if (concept === null || concept.publicationStatus === "deprecated") continue;
      let content: string;
      let contentHash: string;
      try {
        const bytes = await readSafePublication(
          root,
          concept.path,
          Math.min(policy.limits.maxFileBytes, 131_072),
        );
        if (bytes === null) continue;
        content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        contentHash = sha256(bytes);
      } catch {
        continue;
      }
      const linkedClaims = claimsByConcept.get(concept.conceptId) ?? [];
      const assurance =
        linkedClaims.length > 0 || concept.assurance === "human_reviewed"
          ? "human_reviewed"
          : "unreviewed";
      const freshness =
        conceptImpact.get(concept.conceptId) ??
        (concept.sourceUnitVersionIds.length === 0
          ? "unknown"
          : concept.sourceUnitVersionIds.every((id) => currentUnits.has(id))
            ? "current"
            : "stale");
      resolvedConcepts.push({
        conceptId: concept.conceptId,
        path: concept.path,
        contentHash,
        assurance,
        freshness,
        deprecated: false,
      });
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
    const conceptSidecarSetHash = sha256(
      JSON.stringify(
        await Promise.all(
          storedConcepts.map(async (stored) => {
            const bytes = await readSafePublication(root, stored.file, 256 * 1024);
            return [stored.file, bytes === null ? "unreadable" : sha256(bytes)] as const;
          }),
        ),
      ),
    );
    const relationSidecarSetHash = sha256(
      JSON.stringify(
        await Promise.all(
          storedRelations.map(async (stored) => {
            const bytes = await readSafePublication(root, stored.file, 256 * 1024);
            return [stored.file, bytes === null ? "unreadable" : sha256(bytes)] as const;
          }),
        ),
      ),
    );
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
    );
    return new RepositoryKnowledgeQueryIndex({
      sourceSnapshotId: scan.snapshotId,
      impactReportId: impact.reportId,
      conceptSidecarSetHash,
      relationSidecarSetHash,
      entries,
      concepts: resolvedConcepts,
      relations: storedRelations,
      ...(ranker === undefined ? {} : { ranker }),
    });
  }

  query(input: {
    query: string;
    limit?: number;
    documentRegistry?: DocumentRegistry;
  }): KnowledgeQueryResult {
    const rankedHits: KnowledgeQueryHit[] = [];
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
      const withheld = this.data.entries.filter((entry) => !eligible(entry)).length;
      const ranked = this.data.ranker.rank({
        query: input.query,
        limit: (input.limit ?? 20) + withheld,
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
        if (eligible(entry) && rankedHits.length < (input.limit ?? 20))
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
            .slice(0, input.limit ?? 20)
        : rankedHits;
    return {
      schemaVersion: 1,
      query: input.query,
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
      hits: selectedHits,
      relationProjection: projectKnowledgeRelations({
        sourceSnapshotId: this.data.sourceSnapshotId,
        impactReportId: this.data.impactReportId,
        conceptSidecarSetHash: this.data.conceptSidecarSetHash,
        relationSidecarSetHash: this.data.relationSidecarSetHash,
        seedConceptIds: selectedHits.map((hit) => hit.conceptId),
        concepts: this.data.concepts,
        relations: this.data.relations.flatMap((stored) =>
          stored.value === null ? [] : [stored.value],
        ),
        ...(input.documentRegistry === undefined
          ? {}
          : { documentRegistry: input.documentRegistry }),
      }),
    };
  }
}

export async function queryRepositoryKnowledge(input: {
  repositoryRoot: string;
  query: string;
  limit?: number;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  documentRegistry?: DocumentRegistry;
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
    ...(input.documentRegistry === undefined ? {} : { documentRegistry: input.documentRegistry }),
  });
}
