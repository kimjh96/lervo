import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { resolve } from "node:path";

import { loadProjectManifest } from "@lervo/project";
import { loadKnowledgeCompilationCandidate } from "./candidate-store.js";
import { scanConfiguredRepositoryKnowledge } from "./compiler.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import type { KnowledgeCompilationCandidate } from "./semantic-compiler.js";
import { RepositoryKnowledgeError, type RepositoryKnowledgeScanOptions } from "./types.js";
import { createSemanticManagedBlockPatch } from "./user-patch.js";
import { loadStoredConcepts } from "./store-reader.js";

interface ExistingConcept {
  conceptId: string;
  path: string;
  ownership: "user" | "lervo_generated";
  sourceUnitVersionIds: string[];
}

export interface KnowledgeConflictResolutionOption {
  action: "register_existing" | "create_generated" | "add_relation";
  existingConceptId: string | null;
  resolutionHash: string;
}

export interface KnowledgeReconciliationDisposition {
  dispositionId: string;
  subjectKind: "concept" | "relation" | "user_patch";
  subjectId: string;
  action: "register_existing" | "create_generated" | "add_relation" | "propose_user_patch" | "conflict";
  existingConceptId: string | null;
  review: "not_required" | "review_required";
  reasons: Array<"source_identity_match" | "new_source_identity" | "duplicate_candidate" | "contradiction_candidate" | "ambiguous_existing_identity" | "new_relation" | "managed_block_patch" | "ambiguous_managed_block_target">;
  resolutionOptions: KnowledgeConflictResolutionOption[];
  patch: null | {
    candidateConceptId: string;
    patchCandidateId: string;
    patchArtifactHash: string;
    blockId: string;
    sourceHash: string;
    replacementHash: string;
    outputHash: string;
  };
}

export interface KnowledgeReconciliationPlan {
  schemaVersion: 1;
  reconciliationPlanId: string;
  status: "ready" | "review_required" | "conflict";
  projectId: string;
  compilationId: string;
  candidateArtifactHash: string;
  sourceSnapshotId: string;
  policyHash: string;
  compilerBuildId: string;
  registryDigest: string;
  dispositions: KnowledgeReconciliationDisposition[];
}

async function readBoundedFile(path: string): Promise<Buffer> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 256 * 1024) throw new Error("unsafe concept sidecar");
    return await handle.readFile();
  } catch {
    throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", "The existing knowledge concept sidecar cannot be read safely.");
  } finally {
    await handle?.close();
  }
}

async function existingConceptRegistry(root: string): Promise<{ concepts: ExistingConcept[]; registryDigest: string }> {
  const stored = await loadStoredConcepts(root);
  const concepts: ExistingConcept[] = [];
  const materials: Array<{ name: string; contentHash: string }> = [];
  for (const entry of stored) {
    const bytes = await readBoundedFile(resolve(root, entry.file));
    const item = entry.value;
    if (
      item === null || typeof item !== "object" || typeof item.conceptId !== "string" ||
      typeof item.path !== "string" || (item.ownership !== "user" && item.ownership !== "lervo_generated") ||
      !Array.isArray(item.sourceUnitVersionIds) || item.sourceUnitVersionIds.some((id) => typeof id !== "string")
    ) throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", "The knowledge concept sidecar identity contract is invalid.");
    concepts.push({ conceptId: item.conceptId, path: item.path, ownership: item.ownership, sourceUnitVersionIds: [...item.sourceUnitVersionIds].sort() });
    materials.push({ name: entry.file, contentHash: sha256(bytes) });
  }
  return { concepts, registryDigest: sha256(canonicalJson(materials)) };
}

function candidateSignature(concept: KnowledgeCompilationCandidate["concepts"][number]): string {
  return sha256(canonicalJson({
    claims: concept.claims.map((claim) => ({ statementDigest: claim.statementDigest, evidence: [...claim.evidenceUnitVersionIds].sort() })).sort((left, right) => left.statementDigest.localeCompare(right.statementDigest)),
  }));
}

function resolutionOption(input: {
  compilationId: string;
  subjectKind: "concept" | "relation";
  subjectId: string;
  action: KnowledgeConflictResolutionOption["action"];
  existingConceptId: string | null;
}): KnowledgeConflictResolutionOption {
  return { action: input.action, existingConceptId: input.existingConceptId, resolutionHash: sha256(canonicalJson(input)) };
}

export async function createKnowledgeReconciliationPlan(input: {
  repositoryRoot: string;
  compilationId: string;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<KnowledgeReconciliationPlan> {
  const root = resolve(input.repositoryRoot);
  const [{ candidate, artifactHash }, configured, registry, project] = await Promise.all([
    loadKnowledgeCompilationCandidate({ repositoryRoot: root, compilationId: input.compilationId }),
    scanConfiguredRepositoryKnowledge(root, input.supplementalSources === undefined ? {} : { supplementalSources: input.supplementalSources }),
    existingConceptRegistry(root),
    loadProjectManifest(root),
  ]);
  const currentPolicyHash = sha256(canonicalJson(configured.policy));
  if (
    candidate.sourceSnapshotId !== configured.scan.snapshotId || candidate.source.policyId !== configured.policy.policyId ||
    candidate.source.policyHash !== currentPolicyHash || candidate.source.scannerBuild !== configured.scan.scannerBuild
  ) throw new RepositoryKnowledgeError("knowledge_plan_stale", "The semantic candidate source snapshot or policy differs from the current repository.");

  const pathByUnit = new Map(configured.scan.units.map((unit) => [unit.unitVersionId, unit.path]));
  const sourceByPath = new Map(configured.scan.sources.filter((source) => source.content !== undefined && source.contentHash !== null).map((source) => [source.path, source]));
  const existingByPath = new Map<string, ExistingConcept[]>();
  for (const concept of registry.concepts) {
    const values = existingByPath.get(concept.path) ?? [];
    values.push(concept);
    existingByPath.set(concept.path, values);
  }
  const bySignature = new Map<string, string[]>();
  for (const concept of candidate.concepts) {
    const signature = candidateSignature(concept);
    const values = bySignature.get(signature) ?? [];
    values.push(concept.conceptId);
    bySignature.set(signature, values);
  }
  const contradicted = new Set(candidate.relations.filter((relation) => relation.type === "contradicts").flatMap((relation) => [relation.fromConceptId, relation.toConceptId]));
  const dispositions: KnowledgeReconciliationDisposition[] = [];
  const patchDispositionIndexByPath = new Map<string, number>();
  for (const concept of candidate.concepts) {
    const evidencePaths = new Set(concept.claims.flatMap((claim) => claim.evidenceUnitVersionIds.map((id) => {
      const path = pathByUnit.get(id);
      if (path === undefined) throw new RepositoryKnowledgeError("knowledge_reconciliation_conflict", "Candidate evidence is not in the current source-unit allowlist.");
      return path;
    })));
    const matches = evidencePaths.size === 1 ? (existingByPath.get([...evidencePaths][0] ?? "") ?? []) : [];
    const duplicate = (bySignature.get(candidateSignature(concept))?.length ?? 0) > 1;
    const contradiction = contradicted.has(concept.conceptId);
    let action: KnowledgeReconciliationDisposition["action"];
    let existingConceptId: string | null = null;
    const reasons: KnowledgeReconciliationDisposition["reasons"] = [];
    if (matches.length === 1) {
      action = "register_existing";
      existingConceptId = matches[0]?.conceptId ?? null;
      reasons.push("source_identity_match");
    } else if (matches.length === 0) {
      action = "create_generated";
      reasons.push("new_source_identity");
    } else {
      action = "conflict";
      reasons.push("ambiguous_existing_identity");
    }
    if (duplicate) reasons.push("duplicate_candidate");
    if (contradiction) reasons.push("contradiction_candidate");
    if (duplicate || contradiction) action = "conflict";
    const review = duplicate || contradiction || matches.length > 1 ? "review_required" as const : "not_required" as const;
    const resolutionOptions = action !== "conflict" ? [] : matches.length > 1
      ? matches.map((match) => resolutionOption({ compilationId: candidate.compilationId, subjectKind: "concept", subjectId: concept.conceptId, action: "register_existing", existingConceptId: match.conceptId }))
      : [resolutionOption({ compilationId: candidate.compilationId, subjectKind: "concept", subjectId: concept.conceptId, action: matches.length === 1 ? "register_existing" : "create_generated", existingConceptId })];
    dispositions.push({
      dispositionId: stableId("kdisp", { compilationId: candidate.compilationId, subjectId: concept.conceptId, action, existingConceptId, review, reasons, resolutionOptions }),
      subjectKind: "concept",
      subjectId: concept.conceptId,
      action,
      existingConceptId,
      review,
      reasons,
      resolutionOptions,
      patch: null,
    });
    if (action === "register_existing" && review === "not_required" && existingConceptId !== null && evidencePaths.size === 1) {
      const path = [...evidencePaths][0]!;
      const source = sourceByPath.get(path);
      if (source?.content !== undefined && source.contentHash !== null && /\.mdx?$/i.test(path)) {
        const proposed = createSemanticManagedBlockPatch({ path, sourceContent: source.content, sourceHash: source.contentHash, concept });
        if (proposed !== null) {
          const patch = {
            candidateConceptId: concept.conceptId,
            patchCandidateId: proposed.artifact.candidate.candidateId,
            patchArtifactHash: proposed.artifact.contentHash,
            blockId: proposed.artifact.candidate.target.blockId,
            sourceHash: proposed.artifact.candidate.source.contentHash,
            replacementHash: proposed.artifact.candidate.replacement.contentHash,
            outputHash: proposed.artifact.candidate.output.contentHash,
          };
          const proposal: KnowledgeReconciliationDisposition = {
            dispositionId: stableId("kdisp", { compilationId: candidate.compilationId, subjectId: patch.patchCandidateId, action: "propose_user_patch", existingConceptId, review: "review_required", reasons: ["managed_block_patch"], resolutionOptions: [], patch }),
            subjectKind: "user_patch",
            subjectId: patch.patchCandidateId,
            action: "propose_user_patch",
            existingConceptId,
            review: "review_required",
            reasons: ["managed_block_patch"],
            resolutionOptions: [],
            patch,
          };
          const previousIndex = patchDispositionIndexByPath.get(path);
          if (previousIndex === undefined) {
            patchDispositionIndexByPath.set(path, dispositions.length);
            dispositions.push(proposal);
          } else {
            const previous = dispositions[previousIndex]!;
            const conflict = (item: KnowledgeReconciliationDisposition): KnowledgeReconciliationDisposition => ({
              ...item,
              dispositionId: stableId("kdisp", { compilationId: candidate.compilationId, subjectId: item.subjectId, action: "conflict", existingConceptId: item.existingConceptId, review: "review_required", reasons: ["ambiguous_managed_block_target"], resolutionOptions: [], patch: item.patch }),
              action: "conflict",
              reasons: ["ambiguous_managed_block_target"],
              resolutionOptions: [],
            });
            dispositions[previousIndex] = conflict(previous);
            dispositions.push(conflict(proposal));
          }
        }
      }
    }
  }
  for (const relation of candidate.relations) {
    const contradiction = relation.type === "contradicts";
    const action = contradiction ? "conflict" as const : "add_relation" as const;
    const review = contradiction ? "review_required" as const : "not_required" as const;
    const reasons: KnowledgeReconciliationDisposition["reasons"] = [contradiction ? "contradiction_candidate" : "new_relation"];
    const resolutionOptions = contradiction
      ? [resolutionOption({ compilationId: candidate.compilationId, subjectKind: "relation", subjectId: relation.relationId, action: "add_relation", existingConceptId: null })]
      : [];
    dispositions.push({
      dispositionId: stableId("kdisp", { compilationId: candidate.compilationId, subjectId: relation.relationId, action, review, reasons, resolutionOptions }),
      subjectKind: "relation",
      subjectId: relation.relationId,
      action,
      existingConceptId: null,
      review,
      reasons,
      resolutionOptions,
      patch: null,
    });
  }
  dispositions.sort((left, right) => left.subjectKind.localeCompare(right.subjectKind) || left.subjectId.localeCompare(right.subjectId));
  const status = dispositions.some((item) => item.action === "conflict" && item.resolutionOptions.length === 0)
    ? "conflict" as const
    : dispositions.some((item) => item.review === "review_required") ? "review_required" as const : "ready" as const;
  const materials = {
    projectId: project.projectId,
    compilationId: candidate.compilationId,
    candidateArtifactHash: artifactHash,
    sourceSnapshotId: candidate.sourceSnapshotId,
    policyHash: currentPolicyHash,
    compilerBuildId: candidate.compiler.compilerBuildId,
    registryDigest: registry.registryDigest,
    dispositions,
  };
  return { schemaVersion: 1, reconciliationPlanId: stableId("krecon", materials), status, ...materials };
}
