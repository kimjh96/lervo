import {
  candidateConceptSignatureEntries,
  candidateRelationSignatureEntries,
} from "./candidate-signatures.js";
import { canonicalJson, sha256 } from "./integrity.js";
import {
  calculateKnowledgeCompilationId,
  type KnowledgeCompilationCandidate,
} from "./semantic-compiler.js";

export function validKnowledgeCompilationCandidate(
  value: unknown,
): value is KnowledgeCompilationCandidate {
  const item = value as KnowledgeCompilationCandidate | null;
  if (
    item === null ||
    typeof item !== "object" ||
    item.schemaVersion !== 1 ||
    !/^kcomp_[a-f0-9]{24}$/.test(item.compilationId) ||
    !/^ksnap_[a-f0-9]{24}$/.test(item.sourceSnapshotId) ||
    item.source?.scannerBuild !== "repository-scanner-v1" ||
    typeof item.source.policyId !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(item.source.policyHash) ||
    item.source.partitionerBuild !== "semantic-shards-v1" ||
    !/^[a-z][a-z0-9._-]{2,63}$/.test(item.compiler?.compilerId) ||
    typeof item.compiler.compilerVersion !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(item.compiler.compilerBuildId) ||
    (item.compiler.isolation !== "external_no_capabilities" &&
      item.compiler.isolation !== "deterministic_local_derivation") ||
    (item.compiler.provider !== "codex" &&
      item.compiler.provider !== "claude" &&
      item.compiler.provider !== "cross_provider") ||
    !Array.isArray(item.shardIds) ||
    item.shardIds.some((id) => !/^kshard_[a-f0-9]{24}$/.test(id)) ||
    new Set(item.shardIds).size !== item.shardIds.length ||
    item.inventoryCoverage?.complete !== true ||
    item.coverage?.complete !== true ||
    item.coverage.shardCount !== item.shardIds.length ||
    item.coverage.compiledShardCount !== item.shardIds.length ||
    !/^sha256:[a-f0-9]{64}$/.test(item.coverageDigest) ||
    !Array.isArray(item.concepts) ||
    !Array.isArray(item.relations)
  )
    return false;
  if (item.compiler.provider === "cross_provider") {
    const derivation = item.derivation;
    if (
      derivation === undefined ||
      item.compiler.compilerVersion !== "1" ||
      item.compiler.isolation !== "deterministic_local_derivation" ||
      !/^kcompare_[a-f0-9]{24}$/.test(derivation.comparisonId) ||
      !/^kcomp_[a-f0-9]{24}$/.test(derivation.sourceCandidates?.codex?.compilationId) ||
      !/^sha256:[a-f0-9]{64}$/.test(derivation.sourceCandidates.codex.artifactHash) ||
      !/^kcomp_[a-f0-9]{24}$/.test(derivation.sourceCandidates?.claude?.compilationId) ||
      !/^sha256:[a-f0-9]{64}$/.test(derivation.sourceCandidates.claude.artifactHash)
    )
      return false;
    if (derivation.kind === "cross_provider_exact_merge") {
      if (
        item.compiler.compilerId !== "lervo.cross-provider.exact-merge" ||
        !Array.isArray(derivation.selectedConceptSignatures) ||
        !Array.isArray(derivation.selectedClaimSignatures) ||
        !Array.isArray(derivation.selectedRelationSignatures) ||
        derivation.selectedConceptSignatures.length + derivation.selectedClaimSignatures.length <
          1 ||
        [...derivation.selectedConceptSignatures].sort().join("\u0000") !==
          derivation.selectedConceptSignatures.join("\u0000") ||
        [...derivation.selectedClaimSignatures].sort().join("\u0000") !==
          derivation.selectedClaimSignatures.join("\u0000") ||
        [...derivation.selectedRelationSignatures].sort().join("\u0000") !==
          derivation.selectedRelationSignatures.join("\u0000") ||
        new Set(derivation.selectedConceptSignatures).size !==
          derivation.selectedConceptSignatures.length ||
        new Set(derivation.selectedClaimSignatures).size !==
          derivation.selectedClaimSignatures.length ||
        new Set(derivation.selectedRelationSignatures).size !==
          derivation.selectedRelationSignatures.length ||
        [
          ...derivation.selectedConceptSignatures,
          ...derivation.selectedClaimSignatures,
          ...derivation.selectedRelationSignatures,
        ].some((value) => !/^sha256:[a-f0-9]{64}$/.test(value))
      )
        return false;
    } else if (derivation.kind === "cross_provider_approval_gated_fuzzy_merge") {
      const pairs = derivation.fuzzyConceptPairs;
      if (
        item.compiler.compilerId !== "lervo.cross-provider.approval-gated-fuzzy-merge" ||
        derivation.similarity?.algorithm !== "unicode_token_dice_v1" ||
        derivation.similarity.thresholdBasisPoints !== 6000 ||
        derivation.similarity.ambiguityMarginBasisPoints !== 1000 ||
        derivation.similarity.minimumSharedTokens !== 2 ||
        !Array.isArray(pairs) ||
        pairs.length < 1 ||
        pairs.length > 64 ||
        pairs.some(
          (pair) =>
            !/^kfmatch_[a-f0-9]{24}$/.test(pair.matchId) ||
            !Number.isInteger(pair.scoreBasisPoints) ||
            pair.scoreBasisPoints < 6000 ||
            pair.scoreBasisPoints > 10_000 ||
            !/^concept_candidate_[a-f0-9]{24}$/.test(pair.codexSourceConceptId) ||
            !/^concept_candidate_[a-f0-9]{24}$/.test(pair.claudeSourceConceptId) ||
            !Array.isArray(pair.candidateConceptIds) ||
            pair.candidateConceptIds.length !== 2 ||
            pair.candidateConceptIds.some(
              (conceptId) => !/^concept_candidate_[a-f0-9]{24}$/.test(conceptId),
            ),
        ) ||
        pairs.map((pair) => pair.matchId).join("\u0000") !==
          pairs
            .map((pair) => pair.matchId)
            .sort()
            .join("\u0000") ||
        new Set(pairs.map((pair) => pair.matchId)).size !== pairs.length ||
        new Set(pairs.flatMap((pair) => pair.candidateConceptIds)).size !== pairs.length * 2 ||
        new Set(pairs.map((pair) => pair.codexSourceConceptId)).size !== pairs.length ||
        new Set(pairs.map((pair) => pair.claudeSourceConceptId)).size !== pairs.length
      )
        return false;
    } else return false;
  } else if (
    item.derivation !== undefined ||
    item.compiler.isolation !== "external_no_capabilities"
  )
    return false;
  if (
    sha256(
      canonicalJson({
        inventoryCoverage: item.inventoryCoverage,
        coverage: item.coverage,
        shardIds: item.shardIds,
      }),
    ) !== item.coverageDigest
  )
    return false;
  const conceptIds = new Set<string>();
  for (const concept of item.concepts) {
    if (
      concept === null ||
      typeof concept !== "object" ||
      !/^concept_candidate_[a-f0-9]{24}$/.test(concept.conceptId) ||
      conceptIds.has(concept.conceptId) ||
      typeof concept.title !== "string" ||
      typeof concept.summary !== "string" ||
      ![
        "concept",
        "decision",
        "invariant",
        "procedure",
        "responsibility",
        "dependency",
        "open_question",
      ].includes(concept.type) ||
      concept.assurance !== "unreviewed" ||
      !Array.isArray(concept.claims)
    )
      return false;
    conceptIds.add(concept.conceptId);
    const claimIds = new Set<string>();
    for (const claim of concept.claims) {
      if (
        claim === null ||
        typeof claim !== "object" ||
        !/^claim_candidate_[a-f0-9]{24}$/.test(claim.claimId) ||
        claimIds.has(claim.claimId) ||
        typeof claim.statement !== "string" ||
        sha256(claim.statement) !== claim.statementDigest ||
        claim.assurance !== "unreviewed" ||
        !Array.isArray(claim.evidenceUnitVersionIds) ||
        claim.evidenceUnitVersionIds.length < 1 ||
        claim.evidenceUnitVersionIds.some((id) => !/^uv_[a-f0-9]{24}$/.test(id)) ||
        new Set(claim.evidenceUnitVersionIds).size !== claim.evidenceUnitVersionIds.length
      )
        return false;
      claimIds.add(claim.claimId);
    }
  }
  for (const relation of item.relations) {
    if (
      relation === null ||
      typeof relation !== "object" ||
      !/^relation_candidate_[a-f0-9]{24}$/.test(relation.relationId) ||
      !item.concepts.some((concept) => concept.conceptId === relation.fromConceptId) ||
      !item.concepts.some((concept) => concept.conceptId === relation.toConceptId) ||
      !["depends_on", "constrains", "related_to", "supersedes", "contradicts"].includes(
        relation.type,
      ) ||
      relation.assurance !== "unreviewed" ||
      !Array.isArray(relation.evidenceUnitVersionIds) ||
      relation.evidenceUnitVersionIds.length < 1 ||
      relation.evidenceUnitVersionIds.some((id) => !/^uv_[a-f0-9]{24}$/.test(id)) ||
      new Set(relation.evidenceUnitVersionIds).size !== relation.evidenceUnitVersionIds.length
    )
      return false;
  }
  if (item.compiler.provider === "cross_provider") {
    const derivation = item.derivation!;
    if (derivation.kind === "cross_provider_exact_merge") {
      const conceptSignatures = [
        ...new Set(candidateConceptSignatureEntries(item).map((entry) => entry.signature)),
      ].sort();
      const claimSignatures = [
        ...new Set(
          item.concepts.flatMap((concept) =>
            concept.claims.map((claim) =>
              sha256(
                canonicalJson({
                  statementDigest: claim.statementDigest,
                  evidenceUnitVersionIds: [...claim.evidenceUnitVersionIds].sort(),
                }),
              ),
            ),
          ),
        ),
      ].sort();
      const relationSignatures = [
        ...new Set(candidateRelationSignatureEntries(item).map((entry) => entry.signature)),
      ].sort();
      if (
        derivation.selectedConceptSignatures.some(
          (signature) => !conceptSignatures.includes(signature),
        ) ||
        canonicalJson(claimSignatures) !== canonicalJson(derivation.selectedClaimSignatures) ||
        canonicalJson(relationSignatures) !== canonicalJson(derivation.selectedRelationSignatures)
      )
        return false;
    } else {
      const fuzzyConceptIds = derivation.fuzzyConceptPairs.flatMap(
        (pair) => pair.candidateConceptIds,
      );
      if (
        item.relations.length !== 0 ||
        canonicalJson([...fuzzyConceptIds].sort()) !==
          canonicalJson(item.concepts.map((concept) => concept.conceptId).sort())
      )
        return false;
    }
  }
  const { schemaVersion: _schemaVersion, compilationId: _compilationId, ...materials } = item;
  return calculateKnowledgeCompilationId(materials) === item.compilationId;
}
