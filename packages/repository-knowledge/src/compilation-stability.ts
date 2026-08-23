import { candidateSemanticDigest } from "./candidate-signatures.js";
import { loadCurrentKnowledgeCompilationPair } from "./compilation-binding.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { compileRepositoryKnowledgeCandidate, type KnowledgeCompilationCandidate, type RepositorySemanticCompiler } from "./semantic-compiler.js";
import { RepositoryKnowledgeError, type RepositoryKnowledgeScanOptions } from "./types.js";
import type { RepositoryKnowledgeScan } from "./types.js";

export interface KnowledgeCompilationStabilityObservation {
  schemaVersion: 1;
  observationId: string;
  status: "stable" | "divergent";
  provider: "codex" | "claude";
  sourceSnapshotId: string;
  policyHash: string;
  coverageDigest: string;
  compilerBuildId: string;
  baseline: {
    compilationId: string;
    artifactHash: string;
    semanticDigest: string;
    conceptCount: number;
    claimCount: number;
    relationCount: number;
  };
  candidate: {
    compilationId: string;
    artifactHash: string;
    semanticDigest: string;
    conceptCount: number;
    claimCount: number;
    relationCount: number;
  };
  observationBasis: "candidate_artifacts_only" | "two_compile_calls_completed";
  interpretation: "same_build_output_stability_only";
  assurance: "unreviewed";
}

export interface KnowledgeCompilationStabilityGateResult {
  baseline: KnowledgeCompilationCandidate;
  candidate: KnowledgeCompilationCandidate;
  observation: KnowledgeCompilationStabilityObservation;
}

function counts(candidate: KnowledgeCompilationCandidate): {
  conceptCount: number;
  claimCount: number;
  relationCount: number;
} {
  return {
    conceptCount: candidate.concepts.length,
    claimCount: candidate.concepts.reduce((total, concept) => total + concept.claims.length, 0),
    relationCount: candidate.relations.length,
  };
}

function observation(input: {
  baselineCandidate: KnowledgeCompilationCandidate;
  candidate: KnowledgeCompilationCandidate;
  baselineArtifactHash: string;
  candidateArtifactHash: string;
  policyHash: string;
  observationBasis: KnowledgeCompilationStabilityObservation["observationBasis"];
}): KnowledgeCompilationStabilityObservation {
  const baselineSemanticDigest = candidateSemanticDigest(input.baselineCandidate);
  const candidateSemanticDigestValue = candidateSemanticDigest(input.candidate);
  const baseline = {
    compilationId: input.baselineCandidate.compilationId,
    artifactHash: input.baselineArtifactHash,
    semanticDigest: baselineSemanticDigest,
    ...counts(input.baselineCandidate),
  };
  const candidate = {
    compilationId: input.candidate.compilationId,
    artifactHash: input.candidateArtifactHash,
    semanticDigest: candidateSemanticDigestValue,
    ...counts(input.candidate),
  };
  const materials = {
    status: baselineSemanticDigest === candidateSemanticDigestValue ? "stable" as const : "divergent" as const,
    provider: input.baselineCandidate.compiler.provider as "codex" | "claude",
    sourceSnapshotId: input.baselineCandidate.sourceSnapshotId,
    policyHash: input.policyHash,
    coverageDigest: input.baselineCandidate.coverageDigest,
    compilerBuildId: input.baselineCandidate.compiler.compilerBuildId,
    baseline,
    candidate,
    observationBasis: input.observationBasis,
    interpretation: "same_build_output_stability_only" as const,
    assurance: "unreviewed" as const,
  };
  return { schemaVersion: 1, observationId: stableId("kstability", materials), ...materials };
}

export async function observeKnowledgeCompilationStability(input: {
  repositoryRoot: string;
  baselineCompilationId: string;
  candidateCompilationId: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<KnowledgeCompilationStabilityObservation> {
  const pair = await loadCurrentKnowledgeCompilationPair({
    repositoryRoot: input.repositoryRoot,
    firstCompilationId: input.baselineCompilationId,
    secondCompilationId: input.candidateCompilationId,
    ...(input.supplementalSources === undefined ? {} : { supplementalSources: input.supplementalSources }),
  });
  const baselineCandidate = pair.first.candidate;
  const repeatedCandidate = pair.second.candidate;
  if (
    (baselineCandidate.compiler.provider !== "codex" && baselineCandidate.compiler.provider !== "claude") ||
    baselineCandidate.compiler.provider !== repeatedCandidate.compiler.provider ||
    canonicalJson(baselineCandidate.compiler) !== canonicalJson(repeatedCandidate.compiler)
  ) {
    throw new RepositoryKnowledgeError("knowledge_compile_failed", "A stability observation requires two candidates from the same Codex or Claude compiler build.");
  }
  return observation({
    baselineCandidate,
    candidate: repeatedCandidate,
    baselineArtifactHash: pair.first.artifactHash,
    candidateArtifactHash: pair.second.artifactHash,
    policyHash: pair.policyHash,
    observationBasis: "candidate_artifacts_only",
  });
}

export async function runKnowledgeCompilationStabilityGate(input: {
  scan: RepositoryKnowledgeScan;
  policyHash: string;
  compiler: RepositorySemanticCompiler;
  signal: AbortSignal;
}): Promise<KnowledgeCompilationStabilityGateResult> {
  const baseline = await compileRepositoryKnowledgeCandidate(input);
  const candidate = await compileRepositoryKnowledgeCandidate(input);
  const artifactHash = (value: KnowledgeCompilationCandidate): string => sha256(`${canonicalJson(value)}\n`);
  return {
    baseline,
    candidate,
    observation: observation({
      baselineCandidate: baseline,
      candidate,
      baselineArtifactHash: artifactHash(baseline),
      candidateArtifactHash: artifactHash(candidate),
      policyHash: input.policyHash,
      observationBasis: "two_compile_calls_completed",
    }),
  };
}
