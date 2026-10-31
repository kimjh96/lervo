import {
  loadKnowledgeCompilationCandidate,
  type LoadedKnowledgeCompilationCandidate,
} from "./candidate-store.js";
import { scanCompleteConfiguredRepositoryKnowledge } from "./compiler.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { RepositoryKnowledgeError, type RepositoryKnowledgeScanOptions } from "./types.js";

export interface CurrentKnowledgeCompilationPair {
  first: LoadedKnowledgeCompilationCandidate;
  second: LoadedKnowledgeCompilationCandidate;
  policyHash: string;
}

export async function loadCurrentKnowledgeCompilationPair(input: {
  repositoryRoot: string;
  firstCompilationId: string;
  secondCompilationId: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<CurrentKnowledgeCompilationPair> {
  const [first, second, configured] = await Promise.all([
    loadKnowledgeCompilationCandidate({
      repositoryRoot: input.repositoryRoot,
      compilationId: input.firstCompilationId,
    }),
    loadKnowledgeCompilationCandidate({
      repositoryRoot: input.repositoryRoot,
      compilationId: input.secondCompilationId,
    }),
    scanCompleteConfiguredRepositoryKnowledge(
      input.repositoryRoot,
      input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources },
    ),
  ]);
  const policyHash = sha256(canonicalJson(configured.policy));
  const left = first.candidate;
  const right = second.candidate;
  if (
    left.sourceSnapshotId !== right.sourceSnapshotId ||
    left.sourceSnapshotId !== configured.scan.snapshotId ||
    left.source.policyHash !== right.source.policyHash ||
    left.source.policyHash !== policyHash ||
    left.source.policyId !== right.source.policyId ||
    left.source.policyId !== configured.policy.policyId ||
    left.source.scannerBuild !== right.source.scannerBuild ||
    left.source.scannerBuild !== configured.scan.scannerBuild ||
    left.source.partitionerBuild !== right.source.partitionerBuild ||
    left.coverageDigest !== right.coverageDigest ||
    canonicalJson(left.shardIds) !== canonicalJson(right.shardIds) ||
    canonicalJson(left.inventoryCoverage) !== canonicalJson(right.inventoryCoverage)
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The compilation candidate is not bound to the same current source, policy, partition, and coverage.",
    );
  }
  return { first, second, policyHash };
}
