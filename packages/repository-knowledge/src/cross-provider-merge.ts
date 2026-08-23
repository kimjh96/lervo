import { candidateClaimSignatureEntries, candidateConceptSignatureEntries, candidateRelationSignatureEntries } from "./candidate-signatures.js";
import { loadCurrentKnowledgeCompilationPair } from "./compilation-binding.js";
import { compareCurrentKnowledgeCompilationPair, type KnowledgeCompilationComparisonResult } from "./compilation-comparison.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import {
  calculateKnowledgeCompilationId,
  type KnowledgeCompilationCandidate,
  type SemanticCompilerDescriptor,
} from "./semantic-compiler.js";
import { RepositoryKnowledgeError, type RepositoryKnowledgeScanOptions } from "./types.js";

const CROSS_PROVIDER_MERGE_BUILD = sha256(canonicalJson({
  implementation: "lervo-cross-provider-exact-merge-v1",
  semanticSignatures: "candidate-signatures-v1",
}));

const CROSS_PROVIDER_MERGE_COMPILER: SemanticCompilerDescriptor = {
  compilerId: "lervo.cross-provider.exact-merge",
  compilerVersion: "1",
  compilerBuildId: CROSS_PROVIDER_MERGE_BUILD,
  provider: "cross_provider",
  isolation: "deterministic_local_derivation",
};

export interface CrossProviderExactMergeCandidateResult {
  candidate: KnowledgeCompilationCandidate;
  comparison: KnowledgeCompilationComparisonResult;
}

export async function createCrossProviderExactMergeCandidate(input: {
  repositoryRoot: string;
  codexCompilationId: string;
  claudeCompilationId: string;
  comparisonId: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<CrossProviderExactMergeCandidateResult> {
  const pair = await loadCurrentKnowledgeCompilationPair({
    repositoryRoot: input.repositoryRoot,
    firstCompilationId: input.codexCompilationId,
    secondCompilationId: input.claudeCompilationId,
    ...(input.supplementalSources === undefined ? {} : { supplementalSources: input.supplementalSources }),
  });
  const comparison = compareCurrentKnowledgeCompilationPair(pair);
  if (comparison.comparisonId !== input.comparisonId) {
    throw new RepositoryKnowledgeError("knowledge_plan_stale", "The specified comparison ID differs from the current candidate artifact binding.");
  }

  const selectedConceptGroups = comparison.concepts.groups.filter(
    (group) => group.presence === "both" && group.multiplicityMatch,
  );
  const selectedClaimGroups = comparison.claims.groups.filter(
    (group) => group.presence === "both" && group.multiplicityMatch,
  );
  if (selectedConceptGroups.length === 0 && selectedClaimGroups.length === 0) {
    throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", "A merge candidate cannot be created because the two providers share no exact concept or claim.");
  }

  const codex = pair.first.candidate;
  const codexConceptById = new Map(codex.concepts.map((concept) => [concept.conceptId, concept]));
  const conceptSignatureById = new Map(candidateConceptSignatureEntries(codex).map((entry) => [entry.subjectId, entry.signature]));
  const selectedConceptIds = selectedConceptGroups.flatMap((group) => group.codexSubjectIds).sort();
  const remappedConceptIds = new Map<string, string>();
  const concepts = selectedConceptIds.map((sourceConceptId, occurrence) => {
    const source = codexConceptById.get(sourceConceptId);
    const signature = conceptSignatureById.get(sourceConceptId);
    if (source === undefined || signature === undefined) {
      throw new RepositoryKnowledgeError("knowledge_compile_failed", "Concept coordinates from the comparison were not found in the source candidate.");
    }
    const conceptId = stableId("concept_candidate", {
      comparisonId: comparison.comparisonId,
      signature,
      occurrence,
      compiler: CROSS_PROVIDER_MERGE_COMPILER,
    });
    remappedConceptIds.set(sourceConceptId, conceptId);
    return {
      ...structuredClone(source),
      conceptId,
      claims: source.claims.map((claim, claimOccurrence) => ({
        ...structuredClone(claim),
        claimId: stableId("claim_candidate", {
          conceptId,
          statementDigest: claim.statementDigest,
          evidenceUnitVersionIds: claim.evidenceUnitVersionIds,
          occurrence: claimOccurrence,
        }),
      })),
    };
  });
  const sourceClaimById = new Map(codex.concepts.flatMap((concept) => concept.claims.map((claim) => [claim.claimId, claim] as const)));
  const claimSignatureById = new Map(candidateClaimSignatureEntries(codex).map((entry) => [entry.subjectId, entry.signature]));
  const selectedClaimIds = selectedClaimGroups.flatMap((group) => group.codexSubjectIds).sort();
  for (const [occurrence, sourceClaimId] of selectedClaimIds.entries()) {
    const source = sourceClaimById.get(sourceClaimId);
    const signature = claimSignatureById.get(sourceClaimId);
    if (source === undefined || signature === undefined) {
      throw new RepositoryKnowledgeError("knowledge_compile_failed", "Claim coordinates from the comparison were not found in the source candidate.");
    }
    if (codex.concepts.some((concept) => concept.claims.some((claim) => claim.claimId === sourceClaimId) && remappedConceptIds.has(concept.conceptId))) continue;
    const conceptId = stableId("concept_candidate", { comparisonId: comparison.comparisonId, claimSignature: signature, occurrence, compiler: CROSS_PROVIDER_MERGE_COMPILER });
    const claimId = stableId("claim_candidate", { conceptId, claimSignature: signature, occurrence });
    concepts.push({
      conceptId,
      title: `Cross-provider exact claim ${signature.slice("sha256:".length, "sha256:".length + 12)}`,
      type: "concept",
      summary: "Exact source-bound claim emitted by both providers; human review is still required.",
      assurance: "unreviewed",
      claims: [{ ...structuredClone(source), claimId }],
    });
  }

  const exactRelationGroups = comparison.relations.groups.filter(
    (group) => group.presence === "both" && group.multiplicityMatch,
  );
  const selectedRelationIds = new Set(exactRelationGroups.flatMap((group) => group.codexSubjectIds));
  const relationSignatureById = new Map(candidateRelationSignatureEntries(codex).map((entry) => [entry.subjectId, entry.signature]));
  const selectedRelations = codex.relations
    .filter((relation) => selectedRelationIds.has(relation.relationId))
    .flatMap((source, occurrence) => {
      const fromConceptId = remappedConceptIds.get(source.fromConceptId);
      const toConceptId = remappedConceptIds.get(source.toConceptId);
      const signature = relationSignatureById.get(source.relationId);
      if (fromConceptId === undefined || toConceptId === undefined || signature === undefined) return [];
      return [{
        signature,
        candidate: {
          ...structuredClone(source),
          relationId: stableId("relation_candidate", { comparisonId: comparison.comparisonId, signature, occurrence }),
          fromConceptId,
          toConceptId,
        },
      }];
    });
  const relations = selectedRelations.map((item) => item.candidate);
  const selectedRelationSignatures = [...new Set(selectedRelations.map((item) => item.signature))].sort();

  const derivation = {
    kind: "cross_provider_exact_merge" as const,
    comparisonId: comparison.comparisonId,
    sourceCandidates: {
      codex: { compilationId: codex.compilationId, artifactHash: pair.first.artifactHash },
      claude: { compilationId: pair.second.candidate.compilationId, artifactHash: pair.second.artifactHash },
    },
    selectedConceptSignatures: selectedConceptGroups.map((group) => group.signature).sort(),
    selectedClaimSignatures: [...new Set([
      ...selectedClaimGroups.map((group) => group.signature),
      ...selectedConceptIds.flatMap((conceptId) => codexConceptById.get(conceptId)?.claims.map((claim) => claimSignatureById.get(claim.claimId)!) ?? []),
    ])].sort(),
    selectedRelationSignatures,
  };
  const content: Omit<KnowledgeCompilationCandidate, "schemaVersion" | "compilationId"> = {
    sourceSnapshotId: codex.sourceSnapshotId,
    source: structuredClone(codex.source),
    compiler: CROSS_PROVIDER_MERGE_COMPILER,
    derivation,
    shardIds: [...codex.shardIds],
    inventoryCoverage: structuredClone(codex.inventoryCoverage),
    coverage: structuredClone(codex.coverage),
    coverageDigest: codex.coverageDigest,
    concepts,
    relations,
  };
  return {
    comparison,
    candidate: { schemaVersion: 1, compilationId: calculateKnowledgeCompilationId(content), ...content },
  };
}
