import { createDoctorReport } from "@lervo/diagnostics";
import { afterEach, describe, expect, it } from "vitest";

import {
  promoteKnowledgeCandidate,
  reviewKnowledgeCandidate,
  verifiedKnowledgeBytes,
} from "../src/index.js";
import {
  createCandidateFixture,
  healthyDoctorEnvironmentInspections,
  removeStores,
  sequence,
} from "./fixture.js";
import {
  approvedFixture,
  laterRevision,
  pathHash,
  promotionPolicy,
} from "./lifecycle-fixture.js";

afterEach(removeStores);

describe("knowledge review and verified promotion", () => {
  it("requires a policy-authorized human approval and current linked paths", async () => {
    const fixture = await approvedFixture();
    const promotionInput = {
      candidate: fixture.created.candidate,
      candidateArtifact: fixture.created.candidateArtifact,
      review: fixture.review,
      policy: promotionPolicy,
      policyVersion: promotionPolicy.policyVersion,
      events: fixture.storage.events,
      artifactStore: fixture.storage.artifacts,
      createEventId: sequence("evt_verified"),
    };
    await expect(promoteKnowledgeCandidate({
      ...promotionInput,
      currentSnapshot: { revision: laterRevision, files: { "src/decision.ts": pathHash } },
    })).rejects.toMatchObject({ reason: "repository_revision_mismatch" });
    await expect(promoteKnowledgeCandidate({
      ...promotionInput,
      currentSnapshot: { revision: fixture.created.candidate.verifiedRevision, files: {} },
    })).rejects.toMatchObject({ reason: "linked_path_missing" });
    const promoted = await promoteKnowledgeCandidate({
      ...promotionInput,
      currentSnapshot: {
        revision: fixture.created.candidate.verifiedRevision,
        files: { "src/decision.ts": pathHash },
      },
    });

    expect(promoted.knowledge).toMatchObject({
      status: "verified",
      candidate: { candidateId: fixture.created.candidate.candidateId },
      approval: { approvalId: fixture.review.approval.approvalId },
      paths: [{ path: "src/decision.ts", contentHash: pathHash }],
    });
    await expect(fixture.storage.artifacts.get(promoted.knowledgeArtifact.uri)).resolves
      .toEqual(verifiedKnowledgeBytes(promoted.knowledge));
    expect(promoted.recordedEvent.type).toBe("knowledge.verified");
    expect(JSON.stringify(fixture.storage.events.list())).not.toContain(
      "reviewer@example.com",
    );
    fixture.storage.events.close();
  });

  it("rejects changed policy content, unauthorized reviewers, and rejected decisions", async () => {
    const fixture = await createCandidateFixture();
    const reviewInput = {
      candidate: fixture.created.candidate,
      candidateArtifact: fixture.created.candidateArtifact,
      resolvedConflictCandidateIds: [],
      repositoryRevision: fixture.created.candidate.verifiedRevision,
      reviewedAt: "2026-08-19T01:00:00Z",
      runId: "run_knowledge_review",
      sessionId: "ses_knowledge_review",
      events: fixture.storage.events,
      artifactStore: fixture.storage.artifacts,
    };
    await expect(reviewKnowledgeCandidate({
      ...reviewInput,
      policy: {
        ...promotionPolicy,
        allowedReviewerIds: ["reviewer@example.com", "unauthorized@example.com"],
      },
      reviewerId: "unauthorized@example.com",
      decision: "approved",
      createEventId: sequence("evt_policy_tamper"),
    })).rejects.toMatchObject({ reason: "policy_schema_invalid" });
    await expect(reviewKnowledgeCandidate({
      ...reviewInput,
      policy: promotionPolicy,
      reviewerId: "unauthorized@example.com",
      decision: "approved",
      createEventId: sequence("evt_unauthorized"),
    })).rejects.toMatchObject({ reason: "reviewer_not_allowed" });
    const rejected = await reviewKnowledgeCandidate({
      ...reviewInput,
      policy: promotionPolicy,
      reviewerId: "reviewer@example.com",
      decision: "rejected",
      createEventId: sequence("evt_review"),
    });
    await expect(promoteKnowledgeCandidate({
      candidate: fixture.created.candidate,
      candidateArtifact: fixture.created.candidateArtifact,
      review: rejected,
      policy: promotionPolicy,
      currentSnapshot: {
        revision: fixture.created.candidate.verifiedRevision,
        files: { "src/decision.ts": pathHash },
      },
      policyVersion: promotionPolicy.policyVersion,
      events: fixture.storage.events,
      artifactStore: fixture.storage.artifacts,
      createEventId: sequence("evt_verified"),
    })).rejects.toMatchObject({ reason: "approval_not_approved" });
    expect(fixture.storage.events.list().some((event) => event.type === "knowledge.verified"))
      .toBe(false);
    fixture.storage.events.close();
  });

  it("requires policy-requested conflict resolution", async () => {
    const fixture = await createCandidateFixture({ conflicts: ["knc_1111111111111111"] });
    await expect(reviewKnowledgeCandidate({
      candidate: fixture.created.candidate,
      candidateArtifact: fixture.created.candidateArtifact,
      policy: promotionPolicy,
      reviewerId: "reviewer@example.com",
      decision: "approved",
      resolvedConflictCandidateIds: [],
      repositoryRevision: fixture.created.candidate.verifiedRevision,
      reviewedAt: "2026-08-19T01:00:00Z",
      runId: "run_knowledge_review",
      sessionId: "ses_knowledge_review",
      events: fixture.storage.events,
      artifactStore: fixture.storage.artifacts,
      createEventId: sequence("evt_review_conflict"),
    })).rejects.toMatchObject({ reason: "conflicts_unresolved" });
    fixture.storage.events.close();
  });

  it("reports a review event whose approval CAS original is missing", async () => {
    const fixture = await createCandidateFixture();
    const missingHash =
      "sha256:9999999999999999999999999999999999999999999999999999999999999999";
    fixture.storage.events.append({
      eventId: "evt_missing_review_artifact",
      projectId: fixture.created.candidate.projectId,
      runId: "run_knowledge_review",
      sessionId: "ses_knowledge_review",
      type: "knowledge.candidate.reviewed",
      occurredAt: "2026-08-19T01:00:00Z",
      actor: { kind: "user" },
      schemaVersion: 1,
      policyVersion: promotionPolicy.policyVersion,
      payload: {
        candidateId: fixture.created.candidate.candidateId,
        candidateContentHash: fixture.created.candidateArtifact.contentHash,
        approvalId: "knr_9999999999999999",
        approvalArtifactId: `art_${missingHash.slice(7)}`,
        approvalContentHash: missingHash,
        decision: "approved",
        policyId: promotionPolicy.policyId,
        policyVersion: promotionPolicy.policyVersion,
        repositoryRevision: fixture.created.candidate.verifiedRevision,
        resolvedConflictCandidateIds: [],
      },
    });
    await expect(createDoctorReport({
      projectId: fixture.created.candidate.projectId,
      events: fixture.storage.events,
      artifacts: fixture.storage.artifacts,
      inspections: healthyDoctorEnvironmentInspections,
    })).resolves.toMatchObject({
      status: "unhealthy",
      issues: [{ code: "review_artifact_invalid" }],
    });
    fixture.storage.events.close();
  });
});
