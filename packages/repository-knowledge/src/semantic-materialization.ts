import { lstat, readFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { stringify } from "yaml";

import { listKnowledgeArtifactPaths, shardedKnowledgeArtifactPath } from "./artifact-paths.js";
import {
  applyDurableKnowledgeOperations,
  type KnowledgeMaterializationCheckpoint,
} from "./durable-apply.js";
import { loadKnowledgeCompilationCandidate } from "./candidate-store.js";
import { scanConfiguredRepositoryKnowledge } from "./compiler.js";
import { canonicalJson, sha256, stableId } from "./integrity.js";
import { createKnowledgeReconciliationPlan } from "./reconciliation.js";
import {
  calculateKnowledgeReconciliationReviewId,
  type KnowledgeReconciliationReview,
} from "./reconciliation-review.js";
import type { KnowledgeCompilationCandidate } from "./semantic-compiler.js";
import type { KnowledgeFileOperation, RepositoryKnowledgeScanOptions } from "./types.js";
import { RepositoryKnowledgeError } from "./types.js";
import { createSemanticManagedBlockPatch } from "./user-patch.js";

export interface SemanticKnowledgeMaterializationPlan {
  schemaVersion: 1;
  planId: string;
  status: "ready" | "blocked";
  projectId: string;
  repositoryRoot: string;
  reviewId: string;
  reviewArtifactHash: string;
  compilationId: string;
  reconciliationPlanId: string;
  sourceSnapshotId: string;
  policyHash: string;
  registryDigest: string;
  compiler: KnowledgeCompilationCandidate["compiler"];
  coverage: KnowledgeCompilationCandidate["inventoryCoverage"];
  operations: KnowledgeFileOperation[];
  createdConceptIds: string[];
  updatedConceptIds: string[];
  claimIds: string[];
  relationIds: string[];
  userPatchCount: number;
}

export interface SemanticKnowledgeMaterializationReceipt {
  schemaVersion: 1;
  type: "knowledge.materialization.applied";
  operation: "semantic";
  planId: string;
  projectId: string;
  reviewId: string;
  sourceSnapshotId: string;
  appliedAt: string;
  created: string[];
  updated: string[];
  unchanged: string[];
}

function artifactUri(hash: string): string {
  return `lervo-cas://sha256/${hash.slice("sha256:".length)}`;
}

async function loadReview(input: {
  reviewId: string;
  artifacts: ArtifactStore;
  events: EventStore;
}): Promise<{ review: KnowledgeReconciliationReview; artifactHash: string }> {
  const matching = input.events
    .list()
    .filter(
      (event) =>
        event.type === "knowledge.reconciliation.reviewed" &&
        event.payload.reviewId === input.reviewId,
    );
  if (matching.length !== 1)
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "A unique repository semantic review event was not found.",
    );
  const event = matching[0]!;
  const hash = event.payload.reviewArtifactHash as string;
  let bytes: Uint8Array;
  try {
    bytes = await input.artifacts.get(artifactUri(hash));
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "The repository semantic review CAS source cannot be read.",
    );
  }
  if (
    sha256(bytes) !== hash ||
    event.payload.reviewArtifactId !== `art_${hash.slice("sha256:".length)}`
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "The repository semantic review CAS coordinates are invalid.",
    );
  }
  let review: KnowledgeReconciliationReview;
  try {
    review = JSON.parse(Buffer.from(bytes).toString("utf8")) as KnowledgeReconciliationReview;
  } catch {
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "The repository semantic review source is not JSON.",
    );
  }
  const { reviewId: _reviewId, ...materials } = review;
  if (
    calculateKnowledgeReconciliationReviewId(materials) !== input.reviewId ||
    `${canonicalJson(review)}\n` !== Buffer.from(bytes).toString("utf8") ||
    review.projectId !== event.projectId ||
    review.compilationId !== event.payload.compilationId ||
    review.reconciliationPlanId !== event.payload.reconciliationPlanId ||
    review.candidateArtifactHash !== event.payload.candidateArtifactHash ||
    review.sourceSnapshotId !== event.payload.sourceSnapshotId ||
    review.registryDigest !== event.payload.registryDigest ||
    review.decision !== event.payload.decision ||
    review.policy.policyId !== event.payload.policyId ||
    review.policy.policyVersion !== event.payload.policyVersion ||
    review.reviewedAt !== event.payload.reviewedAt ||
    sha256(canonicalJson(review.itemApprovals)) !== event.payload.itemApprovalDigest ||
    event.payload.dispositionCount !==
      review.acceptedDispositionIds.length + review.skippedDispositionIds.length ||
    event.payload.dispositionListTruncated !== event.payload.dispositionCount > 256 ||
    JSON.stringify(review.acceptedDispositionIds.slice(0, 256)) !==
      JSON.stringify(event.payload.acceptedDispositionIds) ||
    JSON.stringify(
      review.skippedDispositionIds.slice(
        0,
        256 - review.acceptedDispositionIds.slice(0, 256).length,
      ),
    ) !== JSON.stringify(event.payload.skippedDispositionIds)
  )
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "The repository semantic review source and event do not match.",
    );
  return { review, artifactHash: hash };
}

function yaml(value: unknown): string {
  return stringify(value, { lineWidth: 0, sortMapEntries: true });
}

async function previousSemanticHashes(root: string): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  const paths = await listKnowledgeArtifactPaths({
    root,
    directory: ".lervo/generated/semantic-manifests",
    extension: "json",
    maximumFiles: 20_000,
  });
  for (const path of paths) {
    try {
      const manifest = JSON.parse(await readFile(resolve(root, path), "utf8")) as {
        outputs?: Array<{ path?: unknown; contentHash?: unknown }>;
      };
      for (const output of manifest.outputs ?? []) {
        if (typeof output.path !== "string" || typeof output.contentHash !== "string") continue;
        const values = result.get(output.path) ?? new Set<string>();
        values.add(output.contentHash);
        result.set(output.path, values);
      }
    } catch {
      /* malformed manifests never grant ownership */
    }
  }
  return result;
}

async function operationFor(
  root: string,
  path: string,
  mediaType: KnowledgeFileOperation["mediaType"],
  content: string,
  previous: Map<string, Set<string>>,
): Promise<KnowledgeFileOperation> {
  const target = resolve(root, path);
  const fromRoot = relative(root, target);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`))
    throw new RepositoryKnowledgeError(
      "knowledge_source_unsafe",
      "The semantic output escapes the repository.",
    );
  const desiredHash = sha256(content);
  try {
    const stat = await lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink())
      return {
        path,
        action: "conflict",
        ownership: "lervo_generated",
        mediaType,
        content,
        desiredHash,
        reason: "target_is_not_regular_file",
      };
    const currentHash = sha256(await readFile(target));
    if (currentHash === desiredHash)
      return {
        path,
        action: "unchanged",
        ownership: "lervo_generated",
        mediaType,
        content,
        expectedCurrentHash: currentHash,
        desiredHash,
      };
    if (previous.get(path)?.has(currentHash) === true)
      return {
        path,
        action: "update",
        ownership: "lervo_generated",
        mediaType,
        content,
        expectedCurrentHash: currentHash,
        desiredHash,
      };
    return {
      path,
      action: "conflict",
      ownership: "lervo_generated",
      mediaType,
      content,
      expectedCurrentHash: currentHash,
      desiredHash,
      reason: "existing_bytes_are_not_a_recorded_semantic_generation",
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return {
        path,
        action: "create",
        ownership: "lervo_generated",
        mediaType,
        content,
        desiredHash,
      };
    throw error;
  }
}

function generatedPublication(input: {
  concept: KnowledgeCompilationCandidate["concepts"][number];
  claimIds: string[];
  evidence: Map<string, { path: string; locator: string }>;
}): string {
  const lines = [
    "<!-- lervo:generated repository-semantic-v1 -->",
    `# ${input.concept.title}`,
    "",
    "> Human-reviewed semantic publication. Review does not imply independent verification.",
    "",
    input.concept.summary,
    "",
    "## Claims",
    "",
  ];
  input.concept.claims.forEach((claim, index) => {
    const sources = claim.evidenceUnitVersionIds.map((id) => {
      const unit = input.evidence.get(id);
      return unit === undefined
        ? `\`${id}\``
        : `\`${unit.path}${unit.locator === "file" ? "" : `#${unit.locator}`}\``;
    });
    lines.push(`- ${claim.statement} (${input.claimIds[index]}; sources: ${sources.join(", ")})`);
  });
  lines.push("");
  return lines.join("\n");
}

export async function createSemanticKnowledgeMaterializationPlan(input: {
  repositoryRoot: string;
  reviewId: string;
  artifacts: ArtifactStore;
  events: EventStore;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<SemanticKnowledgeMaterializationPlan> {
  const root = resolve(input.repositoryRoot);
  const [{ review, artifactHash }, loaded, configured, previous] = await Promise.all([
    loadReview(input),
    (async () => {
      const event = input.events
        .list()
        .find(
          (item) =>
            item.type === "knowledge.reconciliation.reviewed" &&
            item.payload.reviewId === input.reviewId,
        );
      if (event === undefined)
        throw new RepositoryKnowledgeError(
          "knowledge_review_not_eligible",
          "The review event was not found.",
        );
      return loadKnowledgeCompilationCandidate({
        repositoryRoot: root,
        compilationId: event.payload.compilationId as string,
      });
    })(),
    scanConfiguredRepositoryKnowledge(
      root,
      input.supplementalSources === undefined
        ? {}
        : { supplementalSources: input.supplementalSources },
    ),
    previousSemanticHashes(root),
  ]);
  if (review.decision !== "approved")
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "A rejected review cannot be materialized.",
    );
  const reconciliation = await createKnowledgeReconciliationPlan({
    repositoryRoot: root,
    compilationId: review.compilationId,
    supplementalSources: input.supplementalSources,
  });
  if (
    reconciliation.reconciliationPlanId !== review.reconciliationPlanId ||
    reconciliation.candidateArtifactHash !== review.candidateArtifactHash ||
    reconciliation.registryDigest !== review.registryDigest ||
    loaded.artifactHash !== review.candidateArtifactHash ||
    configured.scan.snapshotId !== review.sourceSnapshotId
  )
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The source, candidate, or knowledge registry changed after review.",
    );

  const accepted = new Set(review.acceptedDispositionIds);
  const dispositionBySubject = new Map(
    reconciliation.dispositions.map((item) => [item.subjectId, item]),
  );
  const nativeConceptIds = new Map<string, string>();
  const createdConceptIds: string[] = [];
  const updatedConceptIds: string[] = [];
  const claimIds: string[] = [];
  const relationIds: string[] = [];
  const itemApprovalByDisposition = new Map(
    review.itemApprovals.map((item) => [item.dispositionId, item]),
  );
  const outputs: Array<{
    path: string;
    mediaType: KnowledgeFileOperation["mediaType"];
    content: string;
  }> = [];
  const evidence = new Map(
    configured.scan.units.map((unit) => [
      unit.unitVersionId,
      { unitId: unit.unitId, path: unit.path, locator: unit.locator },
    ]),
  );

  for (const concept of loaded.candidate.concepts) {
    const disposition = dispositionBySubject.get(concept.conceptId);
    if (disposition === undefined || !accepted.has(disposition.dispositionId)) continue;
    const approval = itemApprovalByDisposition.get(disposition.dispositionId);
    const resolution =
      disposition.action === "conflict" && approval?.action === "resolve_conflict"
        ? disposition.resolutionOptions.find(
            (option) => option.resolutionHash === approval.resolutionHash,
          )
        : undefined;
    const resolvedAction = resolution?.action ?? disposition.action;
    const resolvedExistingConceptId =
      resolution?.existingConceptId ?? disposition.existingConceptId;
    const nativeId =
      resolvedAction === "register_existing"
        ? resolvedExistingConceptId!
        : stableId("concept", {
            projectId: reconciliation.projectId,
            candidateConceptId: concept.conceptId,
          });
    nativeConceptIds.set(concept.conceptId, nativeId);
    if (resolvedAction === "register_existing" && resolvedExistingConceptId !== null)
      updatedConceptIds.push(nativeId);
    else if (resolvedAction === "create_generated") createdConceptIds.push(nativeId);
    else
      throw new RepositoryKnowledgeError(
        "knowledge_review_not_eligible",
        "The accepted concept disposition is not safe to materialize.",
      );
    const nativeClaimIds = concept.claims.map((claim) =>
      stableId("claim", {
        conceptId: nativeId,
        statementDigest: claim.statementDigest,
        evidenceUnitVersionIds: claim.evidenceUnitVersionIds,
      }),
    );
    claimIds.push(...nativeClaimIds);
    concept.claims.forEach((claim, index) =>
      outputs.push({
        path: shardedKnowledgeArtifactPath(
          ".lervo/knowledge/claims",
          nativeClaimIds[index]!,
          "yaml",
        ),
        mediaType: "application/yaml",
        content: yaml({
          schemaVersion: 1,
          claimId: nativeClaimIds[index],
          conceptId: nativeId,
          candidateClaimId: claim.claimId,
          statement: claim.statement,
          statementDigest: claim.statementDigest,
          evidenceUnitIds: claim.evidenceUnitVersionIds.map(
            (versionId) => evidence.get(versionId)!.unitId,
          ),
          evidenceUnitVersionIds: claim.evidenceUnitVersionIds,
          assurance: "human_reviewed",
          freshness: "current",
          reviewId: review.reviewId,
          compilerBuildId: loaded.candidate.compiler.compilerBuildId,
        }),
      }),
    );
    if (resolvedAction === "create_generated") {
      const path = `${configured.policy.publicationRoot.replace(/\/$/, "")}/semantic/${nativeId}.md`;
      outputs.push({
        path,
        mediaType: "text/markdown",
        content: generatedPublication({ concept, claimIds: nativeClaimIds, evidence }),
      });
      outputs.push({
        path: shardedKnowledgeArtifactPath(".lervo/knowledge/concepts", nativeId, "yaml"),
        mediaType: "application/yaml",
        content: yaml({
          schemaVersion: 1,
          conceptId: nativeId,
          title: concept.title,
          type: concept.type,
          path,
          ownership: "lervo_generated",
          publicationStatus: "draft",
          assurance: "human_reviewed",
          sourceUnitVersionIds: [
            ...new Set(concept.claims.flatMap((claim) => claim.evidenceUnitVersionIds)),
          ].sort(),
          claimIds: nativeClaimIds,
          reviewId: review.reviewId,
        }),
      });
    }
  }

  for (const relation of loaded.candidate.relations) {
    const disposition = dispositionBySubject.get(relation.relationId);
    if (disposition === undefined || !accepted.has(disposition.dispositionId)) continue;
    const approval = itemApprovalByDisposition.get(disposition.dispositionId);
    const resolution =
      disposition.action === "conflict" && approval?.action === "resolve_conflict"
        ? disposition.resolutionOptions.find(
            (option) => option.resolutionHash === approval.resolutionHash,
          )
        : undefined;
    if ((resolution?.action ?? disposition.action) !== "add_relation")
      throw new RepositoryKnowledgeError(
        "knowledge_review_not_eligible",
        "The accepted relation disposition is not safe to materialize.",
      );
    const fromConceptId = nativeConceptIds.get(relation.fromConceptId);
    const toConceptId = nativeConceptIds.get(relation.toConceptId);
    if (fromConceptId === undefined || toConceptId === undefined)
      throw new RepositoryKnowledgeError(
        "knowledge_review_not_eligible",
        "Both concept endpoints of the accepted relation must also be accepted.",
      );
    const relationId = stableId("relation", {
      fromConceptId,
      toConceptId,
      type: relation.type,
      evidenceUnitVersionIds: relation.evidenceUnitVersionIds,
    });
    relationIds.push(relationId);
    outputs.push({
      path: shardedKnowledgeArtifactPath(".lervo/knowledge/relations", relationId, "yaml"),
      mediaType: "application/yaml",
      content: yaml({
        schemaVersion: 1,
        relationId,
        from: { kind: "concept", id: fromConceptId },
        to: { kind: "concept", id: toConceptId },
        type: relation.type,
        evidenceUnitIds: relation.evidenceUnitVersionIds.map(
          (versionId) => evidence.get(versionId)!.unitId,
        ),
        evidenceUnitVersionIds: relation.evidenceUnitVersionIds,
        assurance: "human_reviewed",
        freshness: "current",
        reviewId: review.reviewId,
        candidateRelationId: relation.relationId,
      }),
    });
  }

  const userPatchOperations: KnowledgeFileOperation[] = [];
  for (const disposition of reconciliation.dispositions.filter(
    (item) => item.action === "propose_user_patch" && accepted.has(item.dispositionId),
  )) {
    const patch = disposition.patch;
    const concept = loaded.candidate.concepts.find(
      (item) => item.conceptId === patch?.candidateConceptId,
    );
    const approval = itemApprovalByDisposition.get(disposition.dispositionId);
    if (
      patch === null ||
      concept === undefined ||
      approval?.action !== "apply_managed_block_patch" ||
      approval.outputHash !== patch.outputHash
    )
      throw new RepositoryKnowledgeError(
        "knowledge_review_not_eligible",
        "The user-byte patch item approval does not match the materialization plan.",
      );
    const regenerated = configured.scan.sources
      .filter((item) => item.contentHash === patch.sourceHash && item.content !== undefined)
      .map((source) => ({
        source,
        proposed: createSemanticManagedBlockPatch({
          path: source.path,
          sourceContent: source.content!,
          sourceHash: source.contentHash!,
          concept,
        }),
      }))
      .find((item) => item.proposed?.artifact.candidate.candidateId === patch.patchCandidateId);
    const source = regenerated?.source;
    const proposed = regenerated?.proposed;
    if (
      source?.content === undefined ||
      source.contentHash === null ||
      proposed === null ||
      proposed === undefined ||
      proposed.artifact.contentHash !== patch.patchArtifactHash ||
      proposed.artifact.candidate.output.contentHash !== approval.outputHash
    )
      throw new RepositoryKnowledgeError(
        "knowledge_plan_stale",
        "The user-byte managed block patch cannot be reproduced as the exact candidate.",
      );
    userPatchOperations.push({
      path: source.path,
      action: "update",
      ownership: "managed_blocks",
      mediaType: "text/markdown",
      content: Buffer.from(proposed.outputBytes).toString("utf8"),
      expectedCurrentHash: source.contentHash,
      desiredHash: proposed.artifact.candidate.output.contentHash,
    });
  }
  if (
    new Set(userPatchOperations.map((operation) => operation.path)).size !==
    userPatchOperations.length
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "One plan cannot apply more than one managed-block patch to the same user document.",
    );
  }

  outputs.sort((left, right) => left.path.localeCompare(right.path));
  const outputHashes = outputs.map((output) => ({
    path: output.path,
    contentHash: sha256(output.content),
  }));
  const generationId = stableId("semgen", {
    projectId: reconciliation.projectId,
    reviewId: review.reviewId,
    outputs: outputHashes,
  });
  const manifest = `${JSON.stringify({ schemaVersion: 1, generationId, kind: "semantic", projectId: reconciliation.projectId, sourceSnapshotId: review.sourceSnapshotId, reviewId: review.reviewId, compiler: loaded.candidate.compiler, outputs: outputHashes }, null, 2)}\n`;
  outputs.push({
    path: shardedKnowledgeArtifactPath(".lervo/generated/semantic-manifests", generationId, "json"),
    mediaType: "application/json",
    content: manifest,
  });
  const operations = [
    ...(await Promise.all(
      outputs.map((output) =>
        operationFor(root, output.path, output.mediaType, output.content, previous),
      ),
    )),
    ...userPatchOperations,
  ];
  operations.sort((left, right) => left.path.localeCompare(right.path));
  const materials = {
    projectId: reconciliation.projectId,
    reviewId: review.reviewId,
    reviewArtifactHash: artifactHash,
    compilationId: review.compilationId,
    reconciliationPlanId: review.reconciliationPlanId,
    sourceSnapshotId: review.sourceSnapshotId,
    policyHash: reconciliation.policyHash,
    registryDigest: reconciliation.registryDigest,
    compilerBuildId: loaded.candidate.compiler.compilerBuildId,
    operations: operations.map(({ content: _content, ...operation }) => operation),
  };
  return {
    schemaVersion: 1,
    planId: stableId("ksmat", materials),
    status: operations.some((item) => item.action === "conflict") ? "blocked" : "ready",
    projectId: reconciliation.projectId,
    repositoryRoot: root,
    reviewId: review.reviewId,
    reviewArtifactHash: artifactHash,
    compilationId: review.compilationId,
    reconciliationPlanId: review.reconciliationPlanId,
    sourceSnapshotId: review.sourceSnapshotId,
    policyHash: reconciliation.policyHash,
    registryDigest: reconciliation.registryDigest,
    compiler: loaded.candidate.compiler,
    coverage: loaded.candidate.inventoryCoverage,
    operations,
    createdConceptIds: createdConceptIds.sort(),
    updatedConceptIds: updatedConceptIds.sort(),
    claimIds: claimIds.sort(),
    relationIds: relationIds.sort(),
    userPatchCount: userPatchOperations.length,
  };
}

export async function applySemanticKnowledgeMaterializationPlan(input: {
  plan: SemanticKnowledgeMaterializationPlan;
  artifacts: ArtifactStore;
  events: EventStore;
  now: Date;
  recordApplied: (receipt: SemanticKnowledgeMaterializationReceipt) => void | Promise<void>;
  failureInjector?: (
    checkpoint: KnowledgeMaterializationCheckpoint,
  ) => "interrupt" | void | Promise<"interrupt" | void>;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<SemanticKnowledgeMaterializationReceipt> {
  if (input.plan.status !== "ready")
    throw new RepositoryKnowledgeError(
      "knowledge_reconciliation_conflict",
      "The semantic materialization plan is not applicable.",
    );
  const current = await createSemanticKnowledgeMaterializationPlan({
    repositoryRoot: input.plan.repositoryRoot,
    reviewId: input.plan.reviewId,
    artifacts: input.artifacts,
    events: input.events,
    supplementalSources: input.supplementalSources,
  });
  if (current.planId !== input.plan.planId)
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The semantic materialization plan differs from the current state.",
    );
  const receipt: SemanticKnowledgeMaterializationReceipt = {
    schemaVersion: 1,
    type: "knowledge.materialization.applied",
    operation: "semantic",
    planId: input.plan.planId,
    projectId: input.plan.projectId,
    reviewId: input.plan.reviewId,
    sourceSnapshotId: input.plan.sourceSnapshotId,
    appliedAt: input.now.toISOString(),
    created: input.plan.operations
      .filter((item) => item.action === "create")
      .map((item) => item.path),
    updated: input.plan.operations
      .filter((item) => item.action === "update")
      .map((item) => item.path),
    unchanged: input.plan.operations
      .filter((item) => item.action === "unchanged")
      .map((item) => item.path),
  };
  return applyDurableKnowledgeOperations({
    repositoryRoot: input.plan.repositoryRoot,
    projectId: input.plan.projectId,
    planId: input.plan.planId,
    operations: input.plan.operations,
    receipt,
    recordApplied: input.recordApplied,
    ...(input.failureInjector === undefined ? {} : { failureInjector: input.failureInjector }),
  });
}
