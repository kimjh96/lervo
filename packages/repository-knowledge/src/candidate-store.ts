import { constants } from "node:fs";
import { lstat, mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";

import { resolveProjectPaths } from "@lervo/project";

import { knowledgeArtifactShard, shardedKnowledgeArtifactPath } from "./artifact-paths.js";
import { candidateConceptSignatureEntries, candidateRelationSignatureEntries } from "./candidate-signatures.js";
import { canonicalJson, sha256 } from "./integrity.js";
import { calculateKnowledgeCompilationId, type KnowledgeCompilationCandidate } from "./semantic-compiler.js";
import { RepositoryKnowledgeError } from "./types.js";

export interface KnowledgeCompilationCandidateReceipt {
  schemaVersion: 1;
  compilationId: string;
  sourceSnapshotId: string;
  artifactPath: string;
  artifactHash: string;
  created: boolean;
  assurance: "unreviewed";
}

export interface LoadedKnowledgeCompilationCandidate {
  candidate: KnowledgeCompilationCandidate;
  artifactPath: string;
  artifactHash: string;
}

function validCandidate(value: unknown): value is KnowledgeCompilationCandidate {
  const item = value as KnowledgeCompilationCandidate | null;
  if (
    item === null || typeof item !== "object" || item.schemaVersion !== 1 ||
    !/^kcomp_[a-f0-9]{24}$/.test(item.compilationId) || !/^ksnap_[a-f0-9]{24}$/.test(item.sourceSnapshotId) ||
    item.source?.scannerBuild !== "repository-scanner-v1" || typeof item.source.policyId !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(item.source.policyHash) || item.source.partitionerBuild !== "semantic-shards-v1" ||
    !/^[a-z][a-z0-9._-]{2,63}$/.test(item.compiler?.compilerId) || typeof item.compiler.compilerVersion !== "string" ||
    !/^sha256:[a-f0-9]{64}$/.test(item.compiler.compilerBuildId) ||
    (item.compiler.isolation !== "external_no_capabilities" && item.compiler.isolation !== "deterministic_local_derivation") ||
    (item.compiler.provider !== "codex" && item.compiler.provider !== "claude" && item.compiler.provider !== "cross_provider") ||
    !Array.isArray(item.shardIds) || item.shardIds.some((id) => !/^kshard_[a-f0-9]{24}$/.test(id)) ||
    new Set(item.shardIds).size !== item.shardIds.length ||
    item.inventoryCoverage?.complete !== true || item.coverage?.complete !== true ||
    item.coverage.shardCount !== item.shardIds.length || item.coverage.compiledShardCount !== item.shardIds.length ||
    !/^sha256:[a-f0-9]{64}$/.test(item.coverageDigest) || !Array.isArray(item.concepts) || !Array.isArray(item.relations)
  ) return false;
  if (item.compiler.provider === "cross_provider") {
    const derivation = item.derivation;
    if (
      item.compiler.compilerId !== "lervo.cross-provider.exact-merge" || item.compiler.compilerVersion !== "1" ||
      item.compiler.isolation !== "deterministic_local_derivation" ||
      derivation?.kind !== "cross_provider_exact_merge" ||
      !/^kcompare_[a-f0-9]{24}$/.test(derivation.comparisonId) ||
      !/^kcomp_[a-f0-9]{24}$/.test(derivation.sourceCandidates?.codex?.compilationId) ||
      !/^sha256:[a-f0-9]{64}$/.test(derivation.sourceCandidates.codex.artifactHash) ||
      !/^kcomp_[a-f0-9]{24}$/.test(derivation.sourceCandidates?.claude?.compilationId) ||
      !/^sha256:[a-f0-9]{64}$/.test(derivation.sourceCandidates.claude.artifactHash) ||
      !Array.isArray(derivation.selectedConceptSignatures) ||
      !Array.isArray(derivation.selectedClaimSignatures) ||
      !Array.isArray(derivation.selectedRelationSignatures) ||
      derivation.selectedConceptSignatures.length + derivation.selectedClaimSignatures.length < 1 ||
      [...derivation.selectedConceptSignatures].sort().join("\u0000") !== derivation.selectedConceptSignatures.join("\u0000") ||
      [...derivation.selectedClaimSignatures].sort().join("\u0000") !== derivation.selectedClaimSignatures.join("\u0000") ||
      [...derivation.selectedRelationSignatures].sort().join("\u0000") !== derivation.selectedRelationSignatures.join("\u0000") ||
      new Set(derivation.selectedConceptSignatures).size !== derivation.selectedConceptSignatures.length ||
      new Set(derivation.selectedClaimSignatures).size !== derivation.selectedClaimSignatures.length ||
      new Set(derivation.selectedRelationSignatures).size !== derivation.selectedRelationSignatures.length ||
      [...derivation.selectedConceptSignatures, ...derivation.selectedClaimSignatures, ...derivation.selectedRelationSignatures].some((value) => !/^sha256:[a-f0-9]{64}$/.test(value))
    ) return false;
  } else if (item.derivation !== undefined || item.compiler.isolation !== "external_no_capabilities") return false;
  if (sha256(canonicalJson({ inventoryCoverage: item.inventoryCoverage, coverage: item.coverage, shardIds: item.shardIds })) !== item.coverageDigest) return false;
  const conceptIds = new Set<string>();
  for (const concept of item.concepts) {
    if (
      concept === null || typeof concept !== "object" || !/^concept_candidate_[a-f0-9]{24}$/.test(concept.conceptId) ||
      conceptIds.has(concept.conceptId) || typeof concept.title !== "string" || typeof concept.summary !== "string" ||
      !["concept", "decision", "invariant", "procedure", "responsibility", "dependency", "open_question"].includes(concept.type) ||
      concept.assurance !== "unreviewed" || !Array.isArray(concept.claims)
    ) return false;
    conceptIds.add(concept.conceptId);
    const claimIds = new Set<string>();
    for (const claim of concept.claims) {
      if (
        claim === null || typeof claim !== "object" || !/^claim_candidate_[a-f0-9]{24}$/.test(claim.claimId) ||
        claimIds.has(claim.claimId) ||
        typeof claim.statement !== "string" || sha256(claim.statement) !== claim.statementDigest || claim.assurance !== "unreviewed" ||
        !Array.isArray(claim.evidenceUnitVersionIds) || claim.evidenceUnitVersionIds.length < 1 ||
        claim.evidenceUnitVersionIds.some((id) => !/^uv_[a-f0-9]{24}$/.test(id)) ||
        new Set(claim.evidenceUnitVersionIds).size !== claim.evidenceUnitVersionIds.length
      ) return false;
      claimIds.add(claim.claimId);
    }
  }
  for (const relation of item.relations) {
    if (
      relation === null || typeof relation !== "object" || !/^relation_candidate_[a-f0-9]{24}$/.test(relation.relationId) ||
      !item.concepts.some((concept) => concept.conceptId === relation.fromConceptId) ||
      !item.concepts.some((concept) => concept.conceptId === relation.toConceptId) ||
      !["depends_on", "constrains", "related_to", "supersedes", "contradicts"].includes(relation.type) ||
      relation.assurance !== "unreviewed" || !Array.isArray(relation.evidenceUnitVersionIds) || relation.evidenceUnitVersionIds.length < 1 ||
      relation.evidenceUnitVersionIds.some((id) => !/^uv_[a-f0-9]{24}$/.test(id)) ||
      new Set(relation.evidenceUnitVersionIds).size !== relation.evidenceUnitVersionIds.length
    ) return false;
  }
  if (item.compiler.provider === "cross_provider") {
    const conceptSignatures = [...new Set(candidateConceptSignatureEntries(item).map((entry) => entry.signature))].sort();
    const claimSignatures = [...new Set(item.concepts.flatMap((concept) => concept.claims.map((claim) =>
      sha256(canonicalJson({ statementDigest: claim.statementDigest, evidenceUnitVersionIds: [...claim.evidenceUnitVersionIds].sort() })),
    )))].sort();
    const relationSignatures = [...new Set(candidateRelationSignatureEntries(item).map((entry) => entry.signature))].sort();
    if (
      item.derivation!.selectedConceptSignatures.some((signature) => !conceptSignatures.includes(signature)) ||
      canonicalJson(claimSignatures) !== canonicalJson(item.derivation!.selectedClaimSignatures) ||
      canonicalJson(relationSignatures) !== canonicalJson(item.derivation!.selectedRelationSignatures)
    ) return false;
  }
  const { schemaVersion: _schemaVersion, compilationId: _compilationId, ...materials } = item;
  return calculateKnowledgeCompilationId(materials) === item.compilationId;
}

async function actualDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

async function ensureCandidateDirectory(root: string): Promise<string> {
  const paths = resolveProjectPaths(root);
  if (!(await actualDirectory(paths.lervoRoot))) {
    throw new RepositoryKnowledgeError("knowledge_compile_failed", "The Lervo project root is not a physical directory.");
  }
  for (const path of [paths.state, paths.knowledgeState, paths.knowledgeCandidates]) {
    try {
      await mkdir(path, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    if (!(await actualDirectory(path))) {
      throw new RepositoryKnowledgeError("knowledge_compile_failed", "The knowledge candidate storage path is not a physical directory.");
    }
  }
  return paths.knowledgeCandidates;
}

async function readExisting(path: string): Promise<Buffer | null> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error("not a regular file");
    return await handle.readFile();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new RepositoryKnowledgeError("knowledge_compile_failed", "The existing knowledge candidate artifact cannot be read safely.");
  } finally {
    await handle?.close();
  }
}

export async function storeKnowledgeCompilationCandidate(input: {
  repositoryRoot: string;
  candidate: KnowledgeCompilationCandidate;
}): Promise<KnowledgeCompilationCandidateReceipt> {
  if (!validCandidate(input.candidate)) {
    throw new RepositoryKnowledgeError("knowledge_compile_failed", "Only a complete semantic compilation candidate can be stored.");
  }
  const root = resolve(input.repositoryRoot);
  const directory = await ensureCandidateDirectory(root);
  const shard = knowledgeArtifactShard(input.candidate.compilationId);
  const artifactPath = shardedKnowledgeArtifactPath(".lervo/state/knowledge/candidates", input.candidate.compilationId, "json");
  const shardDirectory = resolve(directory, shard);
  await mkdir(shardDirectory, { recursive: true, mode: 0o700 });
  const absolute = resolve(shardDirectory, `${input.candidate.compilationId}.json`);
  const bytes = Buffer.from(`${canonicalJson(input.candidate)}\n`, "utf8");
  const artifactHash = sha256(bytes);
  const existing = await readExisting(absolute);
  if (existing !== null) {
    if (!existing.equals(bytes)) {
      throw new RepositoryKnowledgeError("knowledge_compile_failed", "Candidate artifact bytes differ for the same compilation ID.");
    }
    return {
      schemaVersion: 1,
      compilationId: input.candidate.compilationId,
      sourceSnapshotId: input.candidate.sourceSnapshotId,
      artifactPath,
      artifactHash,
      created: false,
      assurance: "unreviewed",
    };
  }
  let handle;
  try {
    handle = await open(
      absolute,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o600,
    );
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      const raced = await readExisting(absolute);
      if (raced?.equals(bytes)) {
        return {
          schemaVersion: 1,
          compilationId: input.candidate.compilationId,
          sourceSnapshotId: input.candidate.sourceSnapshotId,
          artifactPath,
          artifactHash,
          created: false,
          assurance: "unreviewed",
        };
      }
    }
    throw new RepositoryKnowledgeError("knowledge_compile_failed", "The knowledge candidate artifact could not be stored.");
  } finally {
    await handle?.close();
  }
  const directoryHandle = await open(shardDirectory, constants.O_RDONLY);
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  return {
    schemaVersion: 1,
    compilationId: input.candidate.compilationId,
    sourceSnapshotId: input.candidate.sourceSnapshotId,
    artifactPath,
    artifactHash,
    created: true,
    assurance: "unreviewed",
  };
}

export async function loadKnowledgeCompilationCandidate(input: {
  repositoryRoot: string;
  compilationId: string;
}): Promise<LoadedKnowledgeCompilationCandidate> {
  if (!/^kcomp_[a-f0-9]{24}$/.test(input.compilationId)) {
    throw new RepositoryKnowledgeError("knowledge_compile_failed", "The knowledge compilation ID is invalid.");
  }
  const root = resolve(input.repositoryRoot);
  const directory = await ensureCandidateDirectory(root);
  const artifactPath = shardedKnowledgeArtifactPath(".lervo/state/knowledge/candidates", input.compilationId, "json");
  const canonical = resolve(root, artifactPath);
  let bytes = await readExisting(canonical);
  let resolvedArtifactPath = artifactPath;
  const legacyPath = `.lervo/state/knowledge/candidates/${input.compilationId}.json`;
  const legacyBytes = await readExisting(resolve(directory, `${input.compilationId}.json`));
  if (bytes !== null && legacyBytes !== null) {
    throw new RepositoryKnowledgeError("knowledge_compile_failed", "The knowledge candidate exists at both legacy and canonical paths.");
  }
  if (bytes === null) {
    bytes = legacyBytes;
    resolvedArtifactPath = legacyPath;
  }
  if (bytes === null || bytes.byteLength > 4 * 1024 * 1024) {
    throw new RepositoryKnowledgeError("knowledge_compile_failed", "The knowledge candidate artifact was not found or exceeds the size limit.");
  }
  let candidate: unknown;
  try { candidate = JSON.parse(bytes.toString("utf8")); } catch {
    throw new RepositoryKnowledgeError("knowledge_compile_failed", "The knowledge candidate artifact is not valid JSON.");
  }
  if (!validCandidate(candidate) || `${canonicalJson(candidate)}\n` !== bytes.toString("utf8")) {
    throw new RepositoryKnowledgeError("knowledge_compile_failed", "The knowledge candidate artifact has invalid identity, provenance, or canonical bytes.");
  }
  return { candidate, artifactPath: resolvedArtifactPath, artifactHash: sha256(bytes) };
}
