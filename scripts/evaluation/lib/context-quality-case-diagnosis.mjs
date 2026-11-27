import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { digest, artifactBuildHash } from "./context-quality-artifact-identity.mjs";

export async function diagnoseReviewedCases(root, suite) {
  const { RepositoryKnowledgeQueryIndex } =
    await import("../../../packages/repository-knowledge/dist/index.js");
  const { projectTaskQuery } = await import("../../../packages/context/dist/index.js");
  const {
    collectInteractiveKnowledgeSources,
    prepareRepositoryQualityContext,
    productDefaultRepositoryKnowledgeRanker,
  } = await import("../../../packages/repository-context/dist/index.js");
  // The same evidence `lervo knowledge query` reads (ADR-0649).
  const { sources: supplementalSources } = await collectInteractiveKnowledgeSources(root);
  const index = await RepositoryKnowledgeQueryIndex.prepare({
    repositoryRoot: root,
    supplementalSources,
    sourceUnitFailureMode: "file_only",
    ranker: productDefaultRepositoryKnowledgeRanker,
  });
  const cases = [];
  for (const item of suite.cases) {
    const sourceBindings = await Promise.all(
      item.expectedPaths.map(async (path) => ({
        path,
        currentContentHash: digest(await readFile(resolve(root, path))),
      })),
    );
    const arms = [];
    for (const arm of ["raw", "task_projection"]) {
      const projected =
        arm === "raw"
          ? item.query
          : projectTaskQuery({ intent: item.query, continuation: "", targetPaths: [] }).query;
      const result = index.query({ query: projected }); // Preserve the production default limit and first-five preparation.
      const quality = await prepareRepositoryQualityContext({
        repositoryRoot: root,
        origin: "terminal",
        task: {
          intent: item.query,
          continuation: "",
          targetPaths: [],
          artifactKinds: [],
          requestedActions: [],
          conversationLocale: null,
          publicationLocale: null,
          retrievalLanguages: ["en"],
        },
        instructionMaximumBytes: 12288,
        evidenceMaximumBytes: 12288,
        retrieval: "completed",
        candidates: result.hits.slice(0, 5),
        sourceSnapshotId: result.sourceSnapshotId,
        retrievalBuildId: result.ranking?.adapterBuildId ?? "",
        projectedQueries: [projected],
        recordObservation: false,
      });
      const expected = sourceBindings.map((source) => ({
        ...source,
        rank: result.hits.findIndex((hit) => hit.path === source.path) + 1 || null,
        prepared: quality.passages.some((passage) => passage.path === source.path),
      }));
      arms.push({
        arm,
        queryHash: digest(projected),
        sourceSnapshotId: result.sourceSnapshotId,
        ranking: result.ranking,
        returnedCandidateCount: result.hits.length,
        selectedCandidates: result.hits
          .slice(0, 5)
          .map(({ path, contentHash }) => ({ path, contentHash })),
        expected,
        allExpectedWithinReviewedRank: expected.every(
          (row) => row.rank !== null && row.rank <= item.maximumRank,
        ),
        preparationStatus: quality.result.status,
        reasons: quality.result.reasonCodes,
        ownerInstructions: quality.instructions?.report ?? null,
        preparedEvidenceCount: quality.passages.length,
        preparedBytes: quality.result.plan?.coverage.preparedByteCount ?? null,
        unlabelledContextBytes: quality.passages.reduce(
          (sum, passage) => sum + Buffer.byteLength(passage.content),
          0,
        ),
        relevancePrecision: null,
        artifactCompliance: null,
      });
    }
    cases.push({
      familyId: item.caseId,
      interpretation:
        item.contextRequirement === "none"
          ? "current_corpus_retrieval_diagnostic"
          : "original_workstream_context_missing_raw_query_diagnostic_only",
      acceptance: "unavailable",
      arms,
    });
  }
  return {
    observedAt: new Date().toISOString(),
    artifactBuildHash: await artifactBuildHash(root),
    supplementalSourceCount: supplementalSources.length,
    sourceObservation:
      "Fresh complete configured scan; existing file-only source-unit fallback retained. No corpus exclusion or source/result limit changed.",
    cases,
    providerCalls: 0,
    limitations: [
      "Historical reviewed context is not replaced with the current workstream.",
      "Known paths do not label every delivered byte; precision remains unavailable.",
      "No task artifacts or human-reviewed ADR0501 labels exist for this replay.",
      "Current corpus includes historical evidence documents; this is not a contamination-free held-out experiment.",
    ],
  };
}
