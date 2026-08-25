import {
  candidateClaimSignatureEntries,
  candidateConceptSignatureEntries,
  candidateRelationSignatureEntries,
  type CandidateSignatureEntry,
} from "./candidate-signatures.js";
import {
  loadCurrentKnowledgeCompilationPair,
  type CurrentKnowledgeCompilationPair,
} from "./compilation-binding.js";
import { stableId } from "./integrity.js";
import { RepositoryKnowledgeError, type RepositoryKnowledgeScanOptions } from "./types.js";

type ComparisonProvider = "codex" | "claude";

export interface KnowledgeCompilationComparisonGroup {
  signature: string;
  presence: "both" | "codex_only" | "claude_only";
  multiplicityMatch: boolean;
  codexSubjectIds: string[];
  claudeSubjectIds: string[];
}

export interface KnowledgeCompilationComparisonResult {
  schemaVersion: 1;
  comparisonId: string;
  status: "exact_match" | "partial_overlap" | "disjoint" | "empty";
  sourceSnapshotId: string;
  policyHash: string;
  coverageDigest: string;
  candidates: Record<
    ComparisonProvider,
    {
      compilationId: string;
      artifactHash: string;
      compilerBuildId: string;
    }
  >;
  concepts: {
    codexCount: number;
    claudeCount: number;
    exactSharedSignatureCount: number;
    groups: KnowledgeCompilationComparisonGroup[];
  };
  claims: {
    codexCount: number;
    claudeCount: number;
    exactSharedSignatureCount: number;
    groups: KnowledgeCompilationComparisonGroup[];
  };
  relations: {
    codexCount: number;
    claudeCount: number;
    exactSharedSignatureCount: number;
    groups: KnowledgeCompilationComparisonGroup[];
  };
  interpretation: "exact_digest_overlap_only";
  assurance: "unreviewed";
}

const MAX_COMPARISON_SUBJECTS = 8_192;

function comparisonGroups(input: {
  codex: CandidateSignatureEntry[];
  claude: CandidateSignatureEntry[];
}): KnowledgeCompilationComparisonGroup[] {
  const grouped = new Map<string, { codex: string[]; claude: string[] }>();
  for (const provider of ["codex", "claude"] as const) {
    for (const entry of input[provider]) {
      const current = grouped.get(entry.signature) ?? { codex: [], claude: [] };
      current[provider].push(entry.subjectId);
      grouped.set(entry.signature, current);
    }
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([signature, values]) => {
      values.codex.sort();
      values.claude.sort();
      return {
        signature,
        presence:
          values.codex.length > 0 && values.claude.length > 0
            ? "both"
            : values.codex.length > 0
              ? "codex_only"
              : "claude_only",
        multiplicityMatch: values.codex.length === values.claude.length,
        codexSubjectIds: values.codex,
        claudeSubjectIds: values.claude,
      };
    });
}

function comparisonStatus(
  groups: KnowledgeCompilationComparisonGroup[],
): KnowledgeCompilationComparisonResult["status"] {
  if (groups.length === 0) return "empty";
  if (groups.every((group) => group.presence === "both" && group.multiplicityMatch))
    return "exact_match";
  return groups.some((group) => group.presence === "both") ? "partial_overlap" : "disjoint";
}

export function compareCurrentKnowledgeCompilationPair(
  pair: CurrentKnowledgeCompilationPair,
): KnowledgeCompilationComparisonResult {
  const codexLoaded = pair.first;
  const claudeLoaded = pair.second;
  const codex = codexLoaded.candidate;
  const claude = claudeLoaded.candidate;
  if (codex.compiler.provider !== "codex" || claude.compiler.provider !== "claude") {
    throw new RepositoryKnowledgeError(
      "knowledge_compile_failed",
      "Codex and Claude candidates must each use the correct provider coordinates.",
    );
  }
  const policyHash = pair.policyHash;

  const codexConcepts = candidateConceptSignatureEntries(codex);
  const claudeConcepts = candidateConceptSignatureEntries(claude);
  const codexClaims = candidateClaimSignatureEntries(codex);
  const claudeClaims = candidateClaimSignatureEntries(claude);
  const codexRelations = candidateRelationSignatureEntries(codex);
  const claudeRelations = candidateRelationSignatureEntries(claude);
  if (
    codexConcepts.length > MAX_COMPARISON_SUBJECTS ||
    claudeConcepts.length > MAX_COMPARISON_SUBJECTS ||
    codexClaims.length > MAX_COMPARISON_SUBJECTS ||
    claudeClaims.length > MAX_COMPARISON_SUBJECTS ||
    codexRelations.length > MAX_COMPARISON_SUBJECTS ||
    claudeRelations.length > MAX_COMPARISON_SUBJECTS
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_source_limit_exceeded",
      "The cross-provider comparison subject limit was exceeded.",
    );
  }
  const conceptGroups = comparisonGroups({ codex: codexConcepts, claude: claudeConcepts });
  const claimGroups = comparisonGroups({ codex: codexClaims, claude: claudeClaims });
  const relationGroups = comparisonGroups({ codex: codexRelations, claude: claudeRelations });
  const allGroups = [...conceptGroups, ...claimGroups, ...relationGroups];
  const status = comparisonStatus(allGroups);
  const candidates = {
    codex: {
      compilationId: codex.compilationId,
      artifactHash: codexLoaded.artifactHash,
      compilerBuildId: codex.compiler.compilerBuildId,
    },
    claude: {
      compilationId: claude.compilationId,
      artifactHash: claudeLoaded.artifactHash,
      compilerBuildId: claude.compiler.compilerBuildId,
    },
  };
  const concepts = {
    codexCount: codexConcepts.length,
    claudeCount: claudeConcepts.length,
    exactSharedSignatureCount: conceptGroups.filter((group) => group.presence === "both").length,
    groups: conceptGroups,
  };
  const claims = {
    codexCount: codexClaims.length,
    claudeCount: claudeClaims.length,
    exactSharedSignatureCount: claimGroups.filter((group) => group.presence === "both").length,
    groups: claimGroups,
  };
  const relations = {
    codexCount: codexRelations.length,
    claudeCount: claudeRelations.length,
    exactSharedSignatureCount: relationGroups.filter((group) => group.presence === "both").length,
    groups: relationGroups,
  };
  const materials = {
    sourceSnapshotId: codex.sourceSnapshotId,
    policyHash,
    coverageDigest: codex.coverageDigest,
    candidates,
    status,
    concepts,
    claims,
    relations,
    interpretation: "exact_digest_overlap_only" as const,
    assurance: "unreviewed" as const,
  };
  return {
    schemaVersion: 1,
    comparisonId: stableId("kcompare", materials),
    ...materials,
  };
}

export async function compareKnowledgeCompilationCandidates(input: {
  repositoryRoot: string;
  codexCompilationId: string;
  claudeCompilationId: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<KnowledgeCompilationComparisonResult> {
  const pair = await loadCurrentKnowledgeCompilationPair({
    repositoryRoot: input.repositoryRoot,
    firstCompilationId: input.codexCompilationId,
    secondCompilationId: input.claudeCompilationId,
    ...(input.supplementalSources === undefined
      ? {}
      : { supplementalSources: input.supplementalSources }),
  });
  return compareCurrentKnowledgeCompilationPair(pair);
}
