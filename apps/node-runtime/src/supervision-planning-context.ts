import { createHash } from "node:crypto";
import {
  documentIdForPath,
  instructionPathsFor,
  readRepositoryFile,
  repositoryFileExists,
} from "@lervo/context";
import { loadDocumentRegistry } from "@lervo/project";
import { readCurrentWorkstreamState } from "@lervo/repository-knowledge";
import { prepareManagedSearchContext, productDefaultSearchEngine } from "@lervo/repository-context";
import { operatingContractHash } from "@lervo/work-controller";

/** Loads exact planning sources; provider injection and use require later execution evidence. */
export async function loadSupervisionPlanningContext(input: {
  repositoryRoot: string;
  projectId: string;
  workstreamId: string;
  workstreamRevision: number;
  workstreamStatus?: "active" | "completed";
  purpose: string;
  expectedPaths: string[];
  now(): string;
}) {
  const workstream = await readCurrentWorkstreamState(input.repositoryRoot);
  if (
    workstream === null ||
    workstream.snapshot.workstreamId !== input.workstreamId ||
    workstream.snapshot.revision !== input.workstreamRevision ||
    workstream.snapshot.status !== (input.workstreamStatus ?? "active")
  )
    throw new Error("Planning requires the exact workstream revision and lifecycle.");
  const registry = await loadDocumentRegistry(input.repositoryRoot);
  const search = await prepareManagedSearchContext({
    repositoryRoot: input.repositoryRoot,
    projectId: input.projectId,
    query: input.purpose,
    fallbackQuery: input.expectedPaths.join(" "),
    observedAt: new Date(input.now()),
    productDefault: productDefaultSearchEngine,
    documentRegistry: registry,
    expectedPaths: input.expectedPaths,
  });
  const paths = new Map(
    Object.entries(registry.documents).map(([id, document]) => [id, document.path]),
  );
  for (const candidate of search.additionalCandidates)
    paths.set(candidate.documentId, candidate.path);
  const required: string[] = [];
  for (const path of instructionPathsFor(input.expectedPaths)) {
    paths.set(documentIdForPath(path), path);
    if (await repositoryFileExists(input.repositoryRoot, path)) required.push(path);
  }
  if (await repositoryFileExists(input.repositoryRoot, "README.md")) required.push("README.md");
  const selected = search.recommendationBatches.flatMap((batch) =>
    batch.recommendations.filter((item) =>
      batch.selectedRecommendationIds.includes(item.recommendationId),
    ),
  );
  const expected = new Map<string, string | null>(required.map((path) => [path, null]));
  for (const recommendation of selected) {
    const path = paths.get(recommendation.documentId);
    if (path === undefined) throw new Error("A selected planning source has no canonical path.");
    const previous = expected.get(path);
    if (
      previous !== undefined &&
      previous !== null &&
      previous !== recommendation.sourceContentHash
    )
      throw new Error("Planning recommendations disagree on source bytes.");
    expected.set(path, recommendation.sourceContentHash);
  }
  const sources: { path: string; contentHash: string; text: string; required: boolean }[] = [];
  let bytes = Buffer.byteLength(workstream.content);
  const observedAt = input.now();
  for (const [path, expectedHash] of expected) {
    const content = await readRepositoryFile(input.repositoryRoot, path, 131072);
    bytes += content.byteLength;
    if (bytes > 256 * 1024) throw new Error("Planning context exceeds its byte bound.");
    const contentHash = `sha256:${createHash("sha256").update(content).digest("hex")}`;
    if (expectedHash !== null && expectedHash !== contentHash)
      throw new Error("A selected planning source changed before loading.");
    sources.push({
      path,
      contentHash,
      text: new TextDecoder("utf-8", { fatal: true }).decode(content),
      required: required.includes(path),
    });
  }
  if (
    (await readCurrentWorkstreamState(input.repositoryRoot))?.contentHash !== workstream.contentHash
  )
    throw new Error("The workstream changed while loading planning context.");
  const elapsed = Date.parse(input.now()) - Date.parse(observedAt);
  if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 5000)
    throw new Error("The loaded planning sources exceeded their observation window.");
  const evidence = {
    schemaVersion: 1,
    kind: "workforce.planning_context",
    workstreamHash: workstream.contentHash,
    attempts: search.attempts,
    selectedRecommendationIds: selected.map((item) => item.recommendationId),
    loaded: sources.map(({ path, contentHash, required }) => ({ path, contentHash, required })),
    coverage: selected.length === 0 ? "no_recommendations" : "bounded_retrieval",
    injection: "not_observed",
    use: "not_observed",
  };
  return {
    observedAt,
    workstream: workstream.snapshot,
    sources,
    evidence,
    contextHash: operatingContractHash(evidence),
    delivery: {
      additionalCandidates: search.additionalCandidates,
      recommendationBatches: search.recommendationBatches,
    },
  };
}
