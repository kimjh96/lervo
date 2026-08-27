import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import type { ArtifactStore, EventStore } from "@lervo/storage-contract";
import { parse } from "yaml";

import { canonicalJson, sha256, stableId } from "./integrity.js";
import { loadKnowledgeCompilationCandidate } from "./candidate-store.js";
import {
  createKnowledgeReconciliationPlan,
  type KnowledgeReconciliationPlan,
} from "./reconciliation.js";
import { RepositoryKnowledgeError, type RepositoryKnowledgeScanOptions } from "./types.js";

export interface KnowledgeReconciliationReviewPolicy {
  schemaVersion: 1;
  policyId: string;
  policyVersion: string;
  allowedReviewerIds: string[];
  requireCompleteDispositionReview: true;
  conflictDisposition: "skip_only" | "hash_bound_resolution";
}

export type KnowledgeReconciliationItemApproval =
  | { dispositionId: string; action: "apply_managed_block_patch"; outputHash: string }
  | { dispositionId: string; action: "resolve_conflict"; resolutionHash: string };

export interface KnowledgeReconciliationReview {
  schemaVersion: 1;
  reviewId: string;
  projectId: string;
  compilationId: string;
  candidateArtifactHash: string;
  reconciliationPlanId: string;
  sourceSnapshotId: string;
  registryDigest: string;
  decision: "approved" | "rejected";
  reviewer: { kind: "human"; reviewerId: string };
  policy: KnowledgeReconciliationReviewPolicy;
  itemApprovals: KnowledgeReconciliationItemApproval[];
  acceptedDispositionIds: string[];
  skippedDispositionIds: string[];
  reviewedAt: string;
}

const HASH = /^sha256:[a-f0-9]{64}$/;
const POLICY_ID = /^knowledge_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const REVIEWER_ID = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;

function policyMaterials(
  policy: Omit<KnowledgeReconciliationReviewPolicy, "policyVersion">,
): unknown {
  return policy;
}

export function calculateKnowledgeReconciliationReviewPolicyVersion(
  policy: Omit<KnowledgeReconciliationReviewPolicy, "policyVersion">,
): string {
  return sha256(canonicalJson(policyMaterials(policy)));
}

function validatePolicy(value: unknown): asserts value is KnowledgeReconciliationReviewPolicy {
  const policy = value as KnowledgeReconciliationReviewPolicy | null;
  if (
    policy === null ||
    typeof policy !== "object" ||
    policy.schemaVersion !== 1 ||
    typeof policy.policyId !== "string" ||
    !POLICY_ID.test(policy.policyId) ||
    policy.policyId.length > 150 ||
    !HASH.test(policy.policyVersion) ||
    !Array.isArray(policy.allowedReviewerIds) ||
    policy.allowedReviewerIds.length < 1 ||
    policy.allowedReviewerIds.length > 100 ||
    policy.allowedReviewerIds.some(
      (id) => typeof id !== "string" || !REVIEWER_ID.test(id) || id.length > 150,
    ) ||
    new Set(policy.allowedReviewerIds).size !== policy.allowedReviewerIds.length ||
    policy.requireCompleteDispositionReview !== true ||
    (policy.conflictDisposition !== "skip_only" &&
      policy.conflictDisposition !== "hash_bound_resolution")
  )
    throw new RepositoryKnowledgeError(
      "knowledge_review_policy_invalid",
      "The repository semantic review policy contract is invalid.",
    );
  const { policyVersion: _policyVersion, ...materials } = policy;
  if (calculateKnowledgeReconciliationReviewPolicyVersion(materials) !== policy.policyVersion) {
    throw new RepositoryKnowledgeError(
      "knowledge_review_policy_invalid",
      "The repository semantic review policy version does not match its content.",
    );
  }
}

export async function loadKnowledgeReconciliationReviewPolicy(input: {
  repositoryRoot: string;
  policyPath: string;
}): Promise<KnowledgeReconciliationReviewPolicy> {
  const root = resolve(input.repositoryRoot);
  const path = resolve(root, input.policyPath);
  const fromRoot = relative(root, path);
  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    !fromRoot.startsWith(`.lervo${sep}knowledge${sep}review-policies${sep}`)
  )
    throw new RepositoryKnowledgeError(
      "knowledge_review_policy_invalid",
      "The review policy must use a repository-relative path under .lervo/knowledge/review-policies.",
    );
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 64 * 1024) throw new Error("unsafe policy");
    const value: unknown = parse((await handle.readFile()).toString("utf8"));
    validatePolicy(value);
    return structuredClone(value);
  } catch (error) {
    if (error instanceof RepositoryKnowledgeError) throw error;
    throw new RepositoryKnowledgeError(
      "knowledge_review_policy_invalid",
      "The repository semantic review policy cannot be read safely.",
    );
  } finally {
    await handle?.close();
  }
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function reviewMaterials(review: Omit<KnowledgeReconciliationReview, "reviewId">): unknown {
  return review;
}

export function calculateKnowledgeReconciliationReviewId(
  review: Omit<KnowledgeReconciliationReview, "reviewId">,
): string {
  return stableId("krvw", reviewMaterials(review));
}

function validateDispositionDecision(input: {
  plan: KnowledgeReconciliationPlan;
  relationEndpoints: Map<string, [string, string]>;
  duplicateConceptGroups: string[][];
  policy: KnowledgeReconciliationReviewPolicy;
  itemApprovals: KnowledgeReconciliationReview["itemApprovals"];
  decision: "approved" | "rejected";
  acceptedDispositionIds: string[];
  skippedDispositionIds: string[];
}): void {
  const all = input.plan.dispositions.map((item) => item.dispositionId).sort();
  const supplied = [...input.acceptedDispositionIds, ...input.skippedDispositionIds].sort();
  if (JSON.stringify(all) !== JSON.stringify(supplied)) {
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "The review must mark every reconciliation disposition as accepted or skipped.",
    );
  }
  if (input.decision === "rejected" && input.acceptedDispositionIds.length !== 0) {
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "A rejected review cannot accept a disposition.",
    );
  }
  if (input.decision === "approved" && input.acceptedDispositionIds.length === 0) {
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "An approved review must accept at least one safe disposition.",
    );
  }
  const accepted = new Set(input.acceptedDispositionIds);
  const approvals = new Map(input.itemApprovals.map((item) => [item.dispositionId, item]));
  if (approvals.size !== input.itemApprovals.length)
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "User-byte item approval IDs contain duplicates.",
    );
  for (const disposition of input.plan.dispositions) {
    const approval = approvals.get(disposition.dispositionId);
    if (disposition.action === "propose_user_patch" && accepted.has(disposition.dispositionId)) {
      if (
        approval?.action !== "apply_managed_block_patch" ||
        approval.outputHash !== disposition.patch?.outputHash
      ) {
        throw new RepositoryKnowledgeError(
          "knowledge_review_not_eligible",
          "A user-byte patch requires item approval for the disposition's exact output hash.",
        );
      }
    } else if (disposition.action === "conflict" && accepted.has(disposition.dispositionId)) {
      if (
        input.policy.conflictDisposition !== "hash_bound_resolution" ||
        approval?.action !== "resolve_conflict" ||
        !disposition.resolutionOptions.some(
          (option) => option.resolutionHash === approval.resolutionHash,
        )
      ) {
        throw new RepositoryKnowledgeError(
          "knowledge_review_not_eligible",
          "Conflict resolution requires policy authorization and item approval for the disposition's exact resolution hash.",
        );
      }
    } else if (approval !== undefined) {
      throw new RepositoryKnowledgeError(
        "knowledge_review_not_eligible",
        "The item approval does not match an accepted user-byte patch or conflict disposition.",
      );
    }
  }
  const dispositionBySubject = new Map(
    input.plan.dispositions.map((item) => [item.subjectId, item]),
  );
  for (const group of input.duplicateConceptGroups) {
    const acceptedCount = group.filter((subjectId) => {
      const disposition = dispositionBySubject.get(subjectId);
      return disposition !== undefined && accepted.has(disposition.dispositionId);
    }).length;
    if (acceptedCount > 1) {
      throw new RepositoryKnowledgeError(
        "knowledge_review_not_eligible",
        "Only one concept can be selected from the same source-backed duplicate group.",
      );
    }
  }
  const acceptedConcepts = new Set(
    input.plan.dispositions
      .filter((item) => item.subjectKind === "concept" && accepted.has(item.dispositionId))
      .map((item) => item.subjectId),
  );
  for (const relation of input.plan.dispositions.filter(
    (item) => item.subjectKind === "relation" && accepted.has(item.dispositionId),
  )) {
    const endpoints = input.relationEndpoints.get(relation.subjectId);
    if (endpoints === undefined || !endpoints.every((id) => acceptedConcepts.has(id))) {
      throw new RepositoryKnowledgeError(
        "knowledge_review_not_eligible",
        "A relation disposition requires accepted concept endpoints.",
      );
    }
  }
}

export async function reviewKnowledgeReconciliation(input: {
  repositoryRoot: string;
  compilationId: string;
  reconciliationPlanId: string;
  policy: KnowledgeReconciliationReviewPolicy;
  reviewerId: string;
  decision: "approved" | "rejected";
  acceptedDispositionIds: readonly string[];
  skippedDispositionIds: readonly string[];
  itemApprovals?: readonly KnowledgeReconciliationItemApproval[];
  reviewedAt: Date;
  runId: string;
  sessionId: string;
  createEventId: () => string;
  artifacts: ArtifactStore;
  events: EventStore;
  supplementalSources?: RepositoryKnowledgeScanOptions["supplementalSources"];
}): Promise<{
  review: KnowledgeReconciliationReview;
  artifact: { artifactId: string; contentHash: string; uri: string };
  eventId: string;
}> {
  validatePolicy(input.policy);
  if (!input.policy.allowedReviewerIds.includes(input.reviewerId)) {
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "The human reviewer is not authorized by the current policy.",
    );
  }
  const [plan, loadedCandidate] = await Promise.all([
    createKnowledgeReconciliationPlan({
      repositoryRoot: input.repositoryRoot,
      compilationId: input.compilationId,
      supplementalSources: input.supplementalSources,
    }),
    loadKnowledgeCompilationCandidate({
      repositoryRoot: input.repositoryRoot,
      compilationId: input.compilationId,
    }),
  ]);
  if (plan.reconciliationPlanId !== input.reconciliationPlanId) {
    throw new RepositoryKnowledgeError(
      "knowledge_plan_stale",
      "The review request plan ID differs from the current reconciliation plan.",
    );
  }
  const acceptedDispositionIds = sortedUnique(input.acceptedDispositionIds);
  const skippedDispositionIds = sortedUnique(input.skippedDispositionIds);
  const itemApprovals = [...(input.itemApprovals ?? [])]
    .map((item) => ({ ...item }))
    .sort((left, right) => left.dispositionId.localeCompare(right.dispositionId));
  validateDispositionDecision({
    plan,
    relationEndpoints: new Map(
      loadedCandidate.candidate.relations.map((relation) => [
        relation.relationId,
        [relation.fromConceptId, relation.toConceptId],
      ]),
    ),
    duplicateConceptGroups: (() => {
      const groups = new Map<string, string[]>();
      for (const concept of loadedCandidate.candidate.concepts) {
        const signature = sha256(
          canonicalJson({
            claims: concept.claims
              .map((claim) => ({
                statementDigest: claim.statementDigest,
                evidence: [...claim.evidenceUnitVersionIds].sort(),
              }))
              .sort((left, right) => left.statementDigest.localeCompare(right.statementDigest)),
          }),
        );
        const values = groups.get(signature) ?? [];
        values.push(concept.conceptId);
        groups.set(signature, values);
      }
      const exactGroups = [...groups.values()].filter((group) => group.length > 1);
      const fuzzyGroups =
        loadedCandidate.candidate.derivation?.kind === "cross_provider_approval_gated_fuzzy_merge"
          ? loadedCandidate.candidate.derivation.fuzzyConceptPairs.map((pair) => [
              ...pair.candidateConceptIds,
            ])
          : [];
      return [...exactGroups, ...fuzzyGroups];
    })(),
    policy: input.policy,
    itemApprovals,
    decision: input.decision,
    acceptedDispositionIds,
    skippedDispositionIds,
  });
  const content: Omit<KnowledgeReconciliationReview, "reviewId"> = {
    schemaVersion: 1,
    projectId: plan.projectId,
    compilationId: plan.compilationId,
    candidateArtifactHash: plan.candidateArtifactHash,
    reconciliationPlanId: plan.reconciliationPlanId,
    sourceSnapshotId: plan.sourceSnapshotId,
    registryDigest: plan.registryDigest,
    decision: input.decision,
    reviewer: { kind: "human", reviewerId: input.reviewerId },
    policy: structuredClone(input.policy),
    itemApprovals,
    acceptedDispositionIds,
    skippedDispositionIds,
    reviewedAt: input.reviewedAt.toISOString(),
  };
  const review: KnowledgeReconciliationReview = {
    ...content,
    reviewId: calculateKnowledgeReconciliationReviewId(content),
  };
  if (
    input.events
      .list()
      .some(
        (event) =>
          event.type === "knowledge.reconciliation.reviewed" &&
          event.payload.reviewId === review.reviewId,
      )
  ) {
    throw new RepositoryKnowledgeError(
      "knowledge_review_not_eligible",
      "The same repository semantic review source has already been recorded.",
    );
  }
  const bytes = `${canonicalJson(review)}\n`;
  try {
    const stored = await input.artifacts.put(bytes);
    const reloaded = await input.artifacts.get(stored.uri);
    if (sha256(reloaded) !== stored.contentHash || Buffer.from(reloaded).toString("utf8") !== bytes)
      throw new Error("CAS mismatch");
    const artifactId = `art_${stored.contentHash.slice("sha256:".length)}`;
    const boundedAccepted = acceptedDispositionIds.slice(0, 256);
    const boundedSkipped = skippedDispositionIds.slice(0, 256 - boundedAccepted.length);
    const dispositionCount = acceptedDispositionIds.length + skippedDispositionIds.length;
    const event = input.events.append({
      eventId: input.createEventId(),
      projectId: plan.projectId,
      runId: input.runId,
      sessionId: input.sessionId,
      type: "knowledge.reconciliation.reviewed",
      occurredAt: review.reviewedAt,
      actor: { kind: "user" },
      schemaVersion: 1,
      policyVersion: input.policy.policyVersion,
      payload: {
        compilationId: review.compilationId,
        candidateArtifactHash: review.candidateArtifactHash,
        reconciliationPlanId: review.reconciliationPlanId,
        sourceSnapshotId: review.sourceSnapshotId,
        registryDigest: review.registryDigest,
        reviewId: review.reviewId,
        reviewArtifactId: artifactId,
        reviewArtifactHash: stored.contentHash,
        decision: review.decision,
        policyId: review.policy.policyId,
        policyVersion: review.policy.policyVersion,
        itemApprovalDigest: sha256(canonicalJson(itemApprovals)),
        acceptedDispositionIds: boundedAccepted,
        skippedDispositionIds: boundedSkipped,
        dispositionListTruncated: dispositionCount > 256,
        dispositionCount,
        reviewedAt: review.reviewedAt,
      },
    }).event;
    return {
      review,
      artifact: { artifactId, contentHash: stored.contentHash, uri: stored.uri },
      eventId: event.eventId,
    };
  } catch (error) {
    if (error instanceof RepositoryKnowledgeError) throw error;
    throw new RepositoryKnowledgeError(
      "knowledge_review_write_failed",
      "The repository semantic review source or event could not be recorded.",
    );
  }
}
