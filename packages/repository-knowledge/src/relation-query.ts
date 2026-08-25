import type { DocumentRegistry } from "@lervo/schemas";

import { stableId } from "./integrity.js";
import type { StoredRelation } from "./store-reader.js";
import type { KnowledgeRelationProjection, KnowledgeRelationRecommendation } from "./types.js";

export const KNOWLEDGE_RELATION_LIMITS = {
  maximumSeeds: 5,
  maximumExaminedRelations: 64,
  maximumRecommendations: 5,
  maximumSelections: 2,
  hops: 1,
} as const;

export interface RelationConceptCoordinate {
  conceptId: string;
  path: string;
  contentHash: string;
  assurance: "unreviewed" | "human_reviewed";
  freshness: "current" | "stale" | "unknown";
  deprecated: boolean;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function projectKnowledgeRelations(input: {
  sourceSnapshotId: string;
  impactReportId: string;
  conceptSidecarSetHash: string;
  relationSidecarSetHash: string;
  seedConceptIds: readonly string[];
  concepts: readonly RelationConceptCoordinate[];
  relations: readonly StoredRelation[];
  documentRegistry?: DocumentRegistry;
}): KnowledgeRelationProjection {
  const conceptsById = new Map(input.concepts.map((concept) => [concept.conceptId, concept]));
  const seedConceptIds = [...new Set(input.seedConceptIds)]
    .slice(0, KNOWLEDGE_RELATION_LIMITS.maximumSeeds)
    .filter((conceptId) => {
      const concept = conceptsById.get(conceptId);
      return (
        concept !== undefined &&
        !concept.deprecated &&
        concept.assurance === "human_reviewed" &&
        concept.freshness === "current"
      );
    });
  const seeds = new Map(seedConceptIds.map((conceptId, rank) => [conceptId, rank + 1]));
  const conceptsByPath = new Map<string, RelationConceptCoordinate[]>();
  for (const concept of input.concepts) {
    const values = conceptsByPath.get(concept.path) ?? [];
    values.push(concept);
    conceptsByPath.set(concept.path, values);
  }
  const documentsByPath = new Map<string, string[]>();
  for (const [documentId, document] of Object.entries(input.documentRegistry?.documents ?? {})) {
    const values = documentsByPath.get(document.path) ?? [];
    values.push(documentId);
    documentsByPath.set(document.path, values);
  }
  const incident = input.relations
    .filter((relation) => seeds.has(relation.from.id) || seeds.has(relation.to.id))
    .sort((left, right) => compareText(left.relationId, right.relationId));
  const examined = incident.slice(0, KNOWLEDGE_RELATION_LIMITS.maximumExaminedRelations);
  const candidates: Array<KnowledgeRelationRecommendation & { seedRank: number }> = [];
  for (const relation of examined) {
    const fromSeedRank = seeds.get(relation.from.id);
    const toSeedRank = seeds.get(relation.to.id);
    const seedRank = Math.min(
      fromSeedRank ?? Number.MAX_SAFE_INTEGER,
      toSeedRank ?? Number.MAX_SAFE_INTEGER,
    );
    const seedConceptId = fromSeedRank === seedRank ? relation.from.id : relation.to.id;
    const targetConceptId = seedConceptId === relation.from.id ? relation.to.id : relation.from.id;
    const target = conceptsById.get(targetConceptId);
    if (
      target === undefined ||
      target.deprecated ||
      target.assurance !== "human_reviewed" ||
      target.freshness !== "current" ||
      conceptsByPath.get(target.path)?.length !== 1
    ) {
      continue;
    }
    const documentIds = documentsByPath.get(target.path) ?? [];
    if (documentIds.length !== 1) continue;
    candidates.push({
      schemaVersion: 1,
      recommendationId: stableId("krelrec", {
        sourceSnapshotId: input.sourceSnapshotId,
        relationId: relation.relationId,
        seedConceptId,
        targetConceptId,
        documentId: documentIds[0],
        contentHash: target.contentHash,
      }),
      relationId: relation.relationId,
      relationType: relation.type,
      direction: seedConceptId === relation.from.id ? "outgoing" : "incoming",
      seedConceptId,
      targetConceptId,
      documentId: documentIds[0]!,
      path: target.path,
      sourceContentHash: target.contentHash,
      sourceSnapshotId: input.sourceSnapshotId,
      impactReportId: input.impactReportId,
      seedRank,
    });
  }
  const seenDocuments = new Set<string>();
  const recommendations = candidates
    .sort(
      (left, right) =>
        left.seedRank - right.seedRank ||
        compareText(left.relationType, right.relationType) ||
        compareText(left.direction, right.direction) ||
        compareText(left.relationId, right.relationId) ||
        compareText(left.documentId, right.documentId),
    )
    .filter((recommendation) => {
      if (seenDocuments.has(recommendation.documentId)) return false;
      seenDocuments.add(recommendation.documentId);
      return true;
    })
    .slice(0, KNOWLEDGE_RELATION_LIMITS.maximumRecommendations)
    .map(({ seedRank: _seedRank, ...recommendation }) => recommendation);
  const core = {
    schemaVersion: 1 as const,
    sourceSnapshotId: input.sourceSnapshotId,
    impactReportId: input.impactReportId,
    conceptSidecarSetHash: input.conceptSidecarSetHash,
    relationSidecarSetHash: input.relationSidecarSetHash,
    seedConceptIds,
    limits: KNOWLEDGE_RELATION_LIMITS,
    examinedRelationCount: examined.length,
    truncated: incident.length > examined.length,
    recommendations,
  };
  return { ...core, projectionId: stableId("krelproj", core) };
}
