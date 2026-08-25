import type { KnowledgePromotionPolicy } from "@lervo/schemas";

import {
  calculateKnowledgePromotionPolicyVersion,
  promoteKnowledgeCandidate,
  reviewKnowledgeCandidate,
} from "../src/index.js";
import { createCandidateFixture, sequence } from "./fixture.js";

const promotionPolicyContent = {
  schemaVersion: 1,
  policyId: "knowledge_human-review",
  allowedReviewerIds: ["reviewer@example.com"],
  requireHumanReviewer: true,
  requireResolvedConflicts: true,
} satisfies Omit<KnowledgePromotionPolicy, "policyVersion">;

export const promotionPolicy: KnowledgePromotionPolicy = {
  ...promotionPolicyContent,
  policyVersion: calculateKnowledgePromotionPolicyVersion(promotionPolicyContent),
};
export const pathHash = "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
export const changedHash =
  "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
export const laterRevision =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

export async function approvedFixture(input?: { conflicts?: readonly string[] }) {
  const fixture = await createCandidateFixture(input);
  const review = await reviewKnowledgeCandidate({
    candidate: fixture.created.candidate,
    candidateArtifact: fixture.created.candidateArtifact,
    policy: promotionPolicy,
    reviewerId: "reviewer@example.com",
    decision: "approved",
    resolvedConflictCandidateIds: input?.conflicts ?? [],
    repositoryRevision: fixture.created.candidate.verifiedRevision,
    reviewedAt: "2026-08-19T01:00:00Z",
    runId: "run_knowledge_review",
    sessionId: "ses_knowledge_review",
    events: fixture.storage.events,
    artifactStore: fixture.storage.artifacts,
    createEventId: sequence("evt_review"),
  });
  return { ...fixture, review };
}

export async function promotedFixture() {
  const fixture = await approvedFixture();
  const promoted = await promoteKnowledgeCandidate({
    candidate: fixture.created.candidate,
    candidateArtifact: fixture.created.candidateArtifact,
    review: fixture.review,
    policy: promotionPolicy,
    currentSnapshot: {
      revision: fixture.created.candidate.verifiedRevision,
      files: { "src/decision.ts": pathHash },
    },
    policyVersion: promotionPolicy.policyVersion,
    events: fixture.storage.events,
    artifactStore: fixture.storage.artifacts,
    createEventId: sequence("evt_verified"),
  });
  return { ...fixture, promoted };
}
