import { loadCurrentKnowledgeCompilationPair } from "./compilation-binding.js";
import {
  compareCurrentKnowledgeCompilationPair,
  type KnowledgeCompilationComparisonResult,
} from "./compilation-comparison.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import {
  calculateKnowledgeCompilationId,
  type CrossProviderFuzzyConceptPair,
  type KnowledgeCompilationCandidate,
  type SemanticCompilerDescriptor,
} from "./semantic-compiler.js";
import { RepositoryKnowledgeError, type RepositoryKnowledgeScanOptions } from "./types.js";

const SIMILARITY = {
  algorithm: "unicode_token_dice_v1" as const,
  thresholdBasisPoints: 6000 as const,
  ambiguityMarginBasisPoints: 1000 as const,
  minimumSharedTokens: 2 as const,
};
const MAX_FUZZY_PAIRS = 64;
const FUZZY_MERGE_COMPILER: SemanticCompilerDescriptor = {
  compilerId: "lervo.cross-provider.approval-gated-fuzzy-merge",
  compilerVersion: "1",
  compilerBuildId: sha256(
    canonicalJson({ implementation: "approval-gated-fuzzy-merge-v1", similarity: SIMILARITY }),
  ),
  provider: "cross_provider",
  isolation: "deterministic_local_derivation",
};

type CandidateConcept = KnowledgeCompilationCandidate["concepts"][number];

interface ScoredPair {
  matchId: string;
  scoreBasisPoints: number;
  codex: CandidateConcept;
  claude: CandidateConcept;
}

export interface CrossProviderFuzzyMergeCandidateResult {
  candidate: KnowledgeCompilationCandidate;
  comparison: KnowledgeCompilationComparisonResult;
  matches: Array<Pick<CrossProviderFuzzyConceptPair, "matchId" | "scoreBasisPoints">>;
}

function conceptTokens(concept: CandidateConcept): Set<string> {
  const text = concept.claims.map((claim) => claim.statement).join("\n");
  return new Set(
    (
      text
        .normalize("NFKC")
        .toLocaleLowerCase("und")
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).filter((token) => [...token].length > 1),
  );
}

function evidenceIds(concept: CandidateConcept): Set<string> {
  return new Set(concept.claims.flatMap((claim) => claim.evidenceUnitVersionIds));
}

function scoreConcepts(left: CandidateConcept, right: CandidateConcept): number | null {
  if (left.type !== right.type) return null;
  const leftEvidence = evidenceIds(left);
  if (![...evidenceIds(right)].some((id) => leftEvidence.has(id))) return null;
  const leftTokens = conceptTokens(left);
  const rightTokens = conceptTokens(right);
  const shared = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  if (shared < SIMILARITY.minimumSharedTokens) return null;
  const denominator = leftTokens.size + rightTokens.size;
  if (denominator === 0) return null;
  return Math.floor((2 * shared * 10_000) / denominator);
}

function uniquelyBest(pair: ScoredPair, alternatives: ScoredPair[]): boolean {
  const ranked = [...alternatives].sort(
    (left, right) =>
      right.scoreBasisPoints - left.scoreBasisPoints || left.matchId.localeCompare(right.matchId),
  );
  if (ranked[0]?.matchId !== pair.matchId) return false;
  return (
    ranked[1] === undefined ||
    pair.scoreBasisPoints - ranked[1].scoreBasisPoints >= SIMILARITY.ambiguityMarginBasisPoints
  );
}

function fuzzyPairs(input: {
  comparison: KnowledgeCompilationComparisonResult;
  codex: KnowledgeCompilationCandidate;
  claude: KnowledgeCompilationCandidate;
}): ScoredPair[] {
  const exactConceptIds = new Set(
    input.comparison.concepts.groups
      .filter((group) => group.presence === "both")
      .flatMap((group) => [...group.codexSubjectIds, ...group.claudeSubjectIds]),
  );
  const exactClaimIds = new Set(
    input.comparison.claims.groups
      .filter((group) => group.presence === "both")
      .flatMap((group) => [...group.codexSubjectIds, ...group.claudeSubjectIds]),
  );
  const eligible = (concept: CandidateConcept): boolean =>
    !exactConceptIds.has(concept.conceptId) &&
    concept.claims.every((claim) => !exactClaimIds.has(claim.claimId));
  const codex = input.codex.concepts.filter(eligible);
  const claude = input.claude.concepts.filter(eligible);
  const scored = codex.flatMap((codexConcept) =>
    claude.flatMap((claudeConcept) => {
      const scoreBasisPoints = scoreConcepts(codexConcept, claudeConcept);
      if (scoreBasisPoints === null || scoreBasisPoints < SIMILARITY.thresholdBasisPoints)
        return [];
      return [
        {
          matchId: stableId("kfmatch", {
            comparisonId: input.comparison.comparisonId,
            codexConceptId: codexConcept.conceptId,
            claudeConceptId: claudeConcept.conceptId,
            scoreBasisPoints,
            similarity: SIMILARITY,
          }),
          scoreBasisPoints,
          codex: codexConcept,
          claude: claudeConcept,
        },
      ];
    }),
  );
  const selected = scored.filter(
    (pair) =>
      uniquelyBest(
        pair,
        scored.filter((candidate) => candidate.codex.conceptId === pair.codex.conceptId),
      ) &&
      uniquelyBest(
        pair,
        scored.filter((candidate) => candidate.claude.conceptId === pair.claude.conceptId),
      ),
  );
  if (selected.length > MAX_FUZZY_PAIRS)
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      "The approval-gated fuzzy merge pair limit was exceeded.",
    );
  return selected.sort((left, right) => left.matchId.localeCompare(right.matchId));
}

function remapConcept(input: {
  comparisonId: string;
  matchId: string;
  provider: "codex" | "claude";
  source: CandidateConcept;
}): CandidateConcept {
  const conceptId = stableId("concept_candidate", {
    comparisonId: input.comparisonId,
    matchId: input.matchId,
    provider: input.provider,
    sourceConceptId: input.source.conceptId,
    compiler: FUZZY_MERGE_COMPILER,
  });
  return {
    ...structuredClone(input.source),
    conceptId,
    claims: input.source.claims.map((claim, occurrence) => ({
      ...structuredClone(claim),
      claimId: stableId("claim_candidate", {
        conceptId,
        sourceClaimId: claim.claimId,
        occurrence,
      }),
    })),
  };
}

export async function createCrossProviderFuzzyMergeCandidate(input: {
  repositoryRoot: string;
  codexCompilationId: string;
  claudeCompilationId: string;
  comparisonId: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<CrossProviderFuzzyMergeCandidateResult> {
  const pair = await loadCurrentKnowledgeCompilationPair({
    repositoryRoot: input.repositoryRoot,
    firstCompilationId: input.codexCompilationId,
    secondCompilationId: input.claudeCompilationId,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  const comparison = compareCurrentKnowledgeCompilationPair(pair);
  if (comparison.comparisonId !== input.comparisonId)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The specified comparison ID differs from the current candidate artifact binding.",
    );
  const pairs = fuzzyPairs({
    comparison,
    codex: pair.first.candidate,
    claude: pair.second.candidate,
  });
  if (pairs.length === 0)
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "No unambiguous source-backed fuzzy concept pair satisfies the bounded similarity policy.",
    );

  const concepts: CandidateConcept[] = [];
  const fuzzyConceptPairs: CrossProviderFuzzyConceptPair[] = [];
  for (const pairMatch of pairs) {
    const codex = remapConcept({
      comparisonId: comparison.comparisonId,
      matchId: pairMatch.matchId,
      provider: "codex",
      source: pairMatch.codex,
    });
    const claude = remapConcept({
      comparisonId: comparison.comparisonId,
      matchId: pairMatch.matchId,
      provider: "claude",
      source: pairMatch.claude,
    });
    concepts.push(codex, claude);
    fuzzyConceptPairs.push({
      matchId: pairMatch.matchId,
      scoreBasisPoints: pairMatch.scoreBasisPoints,
      codexSourceConceptId: pairMatch.codex.conceptId,
      claudeSourceConceptId: pairMatch.claude.conceptId,
      candidateConceptIds: [codex.conceptId, claude.conceptId],
    });
  }
  const derivation = {
    kind: "cross_provider_approval_gated_fuzzy_merge" as const,
    comparisonId: comparison.comparisonId,
    sourceCandidates: {
      codex: {
        compilationId: pair.first.candidate.compilationId,
        artifactHash: pair.first.artifactHash,
      },
      claude: {
        compilationId: pair.second.candidate.compilationId,
        artifactHash: pair.second.artifactHash,
      },
    },
    similarity: SIMILARITY,
    fuzzyConceptPairs,
  };
  const codex = pair.first.candidate;
  const content: Omit<KnowledgeCompilationCandidate, "schemaVersion" | "compilationId"> = {
    sourceSnapshotId: codex.sourceSnapshotId,
    source: structuredClone(codex.source),
    compiler: FUZZY_MERGE_COMPILER,
    derivation,
    shardIds: [...codex.shardIds],
    inventoryCoverage: structuredClone(codex.inventoryCoverage),
    coverage: structuredClone(codex.coverage),
    coverageDigest: codex.coverageDigest,
    concepts,
    relations: [],
  };
  return {
    comparison,
    candidate: {
      schemaVersion: 1,
      compilationId: calculateKnowledgeCompilationId(content),
      ...content,
    },
    matches: fuzzyConceptPairs.map(({ matchId, scoreBasisPoints }) => ({
      matchId,
      scoreBasisPoints,
    })),
  };
}
