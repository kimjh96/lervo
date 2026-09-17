import { validateSchema } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { projectRepositoryKnowledgeSearch } from "../src/index.js";

const repositoryRevision = `sha256:${"a".repeat(64)}`;
const contentHash = `sha256:${"b".repeat(64)}`;

function input() {
  return {
    query: "토론 근거",
    authorizationCoordinate: "local-cli:repository-reader",
    repositoryRevision,
    adapterId: "search/lexical-v2",
    limit: 10,
    result: {
      sourceSnapshotId: "ksnap_0123456789abcdef01234567",
      impactReportId: "kimpact_0123456789abcdef012345",
      ranking: {
        engine: { id: "lexical", version: 2 },
        adapterBuildId: "sebuild_0123456789abcdef012345",
      },
      hits: [{ conceptId: "concept_0123456789abcdef012345", title: "Deliberation", contentHash }],
    },
  };
}

describe("repository-knowledge product search projector", () => {
  it("projects stable coordinates without query text, source bodies, or native scores", () => {
    const result = projectRepositoryKnowledgeSearch(input());

    expect(validateSchema("productUnifiedSearchResult", result)).toEqual({
      valid: true,
      errors: [],
    });
    expect(result).toMatchObject({
      status: "complete",
      requestedCorpusClasses: ["repository_knowledge"],
      searchPlan: { engineId: "lexical", engineVersion: 2 },
      groups: [
        {
          status: "complete",
          hits: [
            {
              sourceCoordinate: "knowledge:concept_0123456789abcdef012345",
              privacyClass: "restricted",
              rank: 1,
              matchEvidenceKind: "lexical",
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("토론 근거");
    expect(JSON.stringify(result)).not.toContain("score");
  });

  it("returns a completed stage and an empty product result when no source matches", () => {
    const value = input();
    value.result.hits = [];

    expect(projectRepositoryKnowledgeSearch(value)).toMatchObject({
      status: "empty",
      reasonCode: null,
      stageReceipts: [{ status: "completed" }],
      groups: [{ status: "complete", hits: [] }],
    });
  });

  it("fails closed for unobserved ranking coordinates or excess hits", () => {
    const noRanking = input();
    noRanking.result.ranking = undefined as never;
    expect(() => projectRepositoryKnowledgeSearch(noRanking)).toThrowError(
      "observed ranking engine",
    );

    const excess = input();
    excess.limit = 1;
    excess.result.hits.push({
      conceptId: "concept_1123456789abcdef012345",
      title: "Second",
      contentHash,
    });
    expect(() => projectRepositoryKnowledgeSearch(excess)).toThrowError("more hits");
  });
});
