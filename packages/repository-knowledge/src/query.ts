import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import type { DocumentRegistry } from "@lervo/schemas";
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

export async function queryRepositoryKnowledge(input: {
  repositoryRoot: string;
  query: string;
  limit?: number;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
  documentRegistry?: DocumentRegistry;
}): Promise<KnowledgeQueryResult> {
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
  const queryTerms = terms(input.query);
  const hits: KnowledgeQueryHit[] = [];
  const resolvedConcepts: RelationConceptCoordinate[] = [];
  const claimsByConcept = new Map<string, StoredClaim[]>();
  for (const stored of await loadStoredClaims(root)) {
    if (stored.value === null) continue;
    const values = claimsByConcept.get(stored.value.conceptId) ?? [];
    values.push(stored.value);
    claimsByConcept.set(stored.value.conceptId, values);
  }
  const storedConcepts = await loadStoredConcepts(root);
  const storedRelations = await loadStoredRelations(root);
  for (const stored of storedConcepts) {
    const concept = stored.value;
    if (concept === null) continue;
    if (concept.publicationStatus === "deprecated") continue;
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
    const titleTerms = textTerms(concept.title);
    const pathTerms = textTerms(concept.path);
    const bodyTerms = textTerms(
      `${content}\n${linkedClaims.map((claim) => claim.statement).join("\n")}`,
    );
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
    const matchedTerms = queryTerms.filter(
      (term) =>
        hasLexicalTerm(titleTerms, term) ||
        hasLexicalTerm(pathTerms, term) ||
        hasLexicalTerm(bodyTerms, term),
    );
    if (matchedTerms.length === 0) continue;
    const score = matchedTerms.reduce(
      (total, term) =>
        total +
        (hasLexicalTerm(titleTerms, term) ? 8 : 0) +
        (hasLexicalTerm(pathTerms, term) ? 4 : 0) +
        (hasLexicalTerm(bodyTerms, term) ? 1 : 0),
      0,
    );
    hits.push({
      conceptId: concept.conceptId,
      title: concept.title,
      path: concept.path,
      ownership: concept.ownership,
      score,
      matchedTerms,
      assurance,
      freshness,
      contentHash,
    });
  }
  hits.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
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
  const strongestScore = hits[0]?.score ?? 0;
  const relativeRelevanceFloor = Math.max(1, Math.ceil(strongestScore / 10));
  const selectedHits = hits
    .filter((hit) => hit.score >= relativeRelevanceFloor)
    .slice(0, input.limit ?? 20);
  return {
    schemaVersion: 1,
    query: input.query,
    semantics: "recommended",
    sourceSnapshotId: scan.snapshotId,
    impactReportId: impact.reportId,
    hits: selectedHits,
    relationProjection: projectKnowledgeRelations({
      sourceSnapshotId: scan.snapshotId,
      impactReportId: impact.reportId,
      conceptSidecarSetHash,
      relationSidecarSetHash,
      seedConceptIds: selectedHits.map((hit) => hit.conceptId),
      concepts: resolvedConcepts,
      relations: storedRelations.flatMap((stored) => (stored.value === null ? [] : [stored.value])),
      ...(input.documentRegistry === undefined ? {} : { documentRegistry: input.documentRegistry }),
    }),
  };
}
