import type { DocumentRegistry } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { projectKnowledgeRelations, type StoredRelation } from "../src/index.js";

function registry(path = "docs/target.md"): DocumentRegistry {
  return {
    schemaVersion: 1,
    documents: {
      doc_target: {
        path,
        kind: "canonical",
        responsibleParty: { kind: "team", id: "platform" },
        connectedPaths: ["src/**"],
        verifiedRevision: "fixture-v1",
        verifiedAt: "2026-08-25T00:00:00Z",
        reviewIntervalDays: 30,
        ownership: { mode: "user" },
      },
    },
  };
}

const relation: StoredRelation = {
  schemaVersion: 1,
  relationId: "relation_seed_target",
  from: { kind: "concept", id: "concept_seed" },
  to: { kind: "concept", id: "concept_target" },
  type: "depends_on",
  evidenceUnitVersionIds: ["unit_v1"],
  assurance: "human_reviewed",
  freshness: "current",
  reviewId: "review_1",
};

const concepts = [
  {
    conceptId: "concept_seed",
    path: "docs/seed.md",
    contentHash: `sha256:${"1".repeat(64)}`,
    assurance: "human_reviewed" as const,
    freshness: "current" as const,
    deprecated: false,
  },
  {
    conceptId: "concept_target",
    path: "docs/target.md",
    contentHash: `sha256:${"2".repeat(64)}`,
    assurance: "human_reviewed" as const,
    freshness: "current" as const,
    deprecated: false,
  },
];

describe("reviewed repository relation projection", () => {
  it("recommends one registered current target and binds rebuild coordinates", () => {
    const input = {
      sourceSnapshotId: "ksnap_fixture",
      impactReportId: "kimpact_fixture",
      conceptSidecarSetHash: `sha256:${"3".repeat(64)}`,
      relationSidecarSetHash: `sha256:${"4".repeat(64)}`,
      seedConceptIds: ["concept_seed"],
      concepts,
      relations: [relation],
      documentRegistry: registry(),
    };
    const forward = projectKnowledgeRelations(input);
    const repeated = projectKnowledgeRelations({
      ...input,
      relations: [...input.relations].reverse(),
    });

    expect(repeated).toEqual(forward);
    expect(forward.recommendations).toEqual([
      expect.objectContaining({
        relationId: relation.relationId,
        targetConceptId: "concept_target",
        documentId: "doc_target",
        sourceContentHash: `sha256:${"2".repeat(64)}`,
      }),
    ]);
    expect(forward.limits).toMatchObject({ hops: 1, maximumRecommendations: 5 });
  });

  it("excludes an ambiguous concept path and changes identity with sidecar bytes", () => {
    const base = {
      sourceSnapshotId: "ksnap_fixture",
      impactReportId: "kimpact_fixture",
      conceptSidecarSetHash: `sha256:${"3".repeat(64)}`,
      relationSidecarSetHash: `sha256:${"4".repeat(64)}`,
      seedConceptIds: ["concept_seed"],
      relations: [relation],
      documentRegistry: registry(),
    };
    const ambiguous = projectKnowledgeRelations({
      ...base,
      concepts: [...concepts, { ...concepts[1]!, conceptId: "concept_duplicate" }],
    });
    const changed = projectKnowledgeRelations({
      ...base,
      concepts,
      relationSidecarSetHash: `sha256:${"5".repeat(64)}`,
    });

    expect(ambiguous.recommendations).toEqual([]);
    expect(changed.projectionId).not.toBe(
      projectKnowledgeRelations({ ...base, concepts }).projectionId,
    );
    expect(
      projectKnowledgeRelations({
        ...base,
        concepts: [{ ...concepts[0]!, assurance: "unreviewed" }, concepts[1]!],
      }).recommendations,
    ).toEqual([]);
  });
});
