import { canonicalJson, sha256 } from "./integrity.js";
import type { KnowledgeCompilationCandidate } from "./semantic-compiler.js";

export interface CandidateSignatureEntry {
  signature: string;
  subjectId: string;
}

export function claimSemanticSignature(
  claim: KnowledgeCompilationCandidate["concepts"][number]["claims"][number],
): string {
  return sha256(
    canonicalJson({
      statementDigest: claim.statementDigest,
      evidenceUnitVersionIds: [...claim.evidenceUnitVersionIds].sort(),
    }),
  );
}

export function conceptSemanticSignatures(
  candidate: KnowledgeCompilationCandidate,
): Map<string, string> {
  return new Map(
    candidate.concepts.map((concept) => [
      concept.conceptId,
      sha256(
        canonicalJson({
          type: concept.type,
          titleDigest: sha256(concept.title),
          summaryDigest: sha256(concept.summary),
          claimSignatures: concept.claims.map(claimSemanticSignature).sort(),
        }),
      ),
    ]),
  );
}

export function candidateConceptSignatureEntries(
  candidate: KnowledgeCompilationCandidate,
): CandidateSignatureEntry[] {
  const signatures = conceptSemanticSignatures(candidate);
  return candidate.concepts.map((concept) => ({
    signature: signatures.get(concept.conceptId)!,
    subjectId: concept.conceptId,
  }));
}

export function candidateClaimSignatureEntries(
  candidate: KnowledgeCompilationCandidate,
): CandidateSignatureEntry[] {
  return candidate.concepts.flatMap((concept) =>
    concept.claims.map((claim) => ({
      signature: claimSemanticSignature(claim),
      subjectId: claim.claimId,
    })),
  );
}

export function candidateRelationSignatureEntries(
  candidate: KnowledgeCompilationCandidate,
): CandidateSignatureEntry[] {
  const concepts = conceptSemanticSignatures(candidate);
  return candidate.relations.map((relation) => ({
    signature: sha256(
      canonicalJson({
        fromConceptSignature: concepts.get(relation.fromConceptId),
        toConceptSignature: concepts.get(relation.toConceptId),
        type: relation.type,
        evidenceUnitVersionIds: [...relation.evidenceUnitVersionIds].sort(),
      }),
    ),
    subjectId: relation.relationId,
  }));
}

export function candidateSemanticDigest(candidate: KnowledgeCompilationCandidate): string {
  return sha256(
    canonicalJson({
      concepts: candidateConceptSignatureEntries(candidate)
        .map((entry) => entry.signature)
        .sort(),
      claims: candidateClaimSignatureEntries(candidate)
        .map((entry) => entry.signature)
        .sort(),
      relations: candidateRelationSignatureEntries(candidate)
        .map((entry) => entry.signature)
        .sort(),
    }),
  );
}
