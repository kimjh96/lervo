import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

import { inspectCandidate } from "./candidate-inspection.js";
import { inspectKnowledgeReview } from "./review-inspection.js";
import { inspectKnowledgeStaleness } from "./staleness-inspection.js";
import type { DoctorIssue, DoctorReport } from "./types.js";
import { inspectVerifiedKnowledge } from "./verified-inspection.js";

export async function createDoctorReport(input: {
  projectId: string;
  events: EventStore;
  artifacts: ArtifactStore;
}): Promise<DoctorReport> {
  const issues: DoctorIssue[] = [];
  let eventCount = 0;
  try {
    eventCount = input.events.verifyIntegrity().eventCount;
  } catch {
    issues.push({
      code: "event_chain_invalid",
      eventId: null,
      message: "로컬 event hash chain이 유효하지 않습니다.",
    });
  }
  const events = input.events.list();
  const candidateEvents = events.filter((event) => event.type === "knowledge.candidate.created");
  const candidateIssues = await Promise.all(candidateEvents.map((event) =>
    inspectCandidate({
      event,
      events,
      artifacts: input.artifacts,
    })));
  issues.push(...candidateIssues.flat());
  const reviewEvents = events.filter((event) => event.type === "knowledge.candidate.reviewed");
  const reviewIssues = await Promise.all(reviewEvents.map((event) =>
    inspectKnowledgeReview({ event, events, artifacts: input.artifacts })));
  issues.push(...reviewIssues.flat());
  const verifiedEvents = events.filter((event) => event.type === "knowledge.verified");
  const verifiedIssues = await Promise.all(verifiedEvents.map((event) =>
    inspectVerifiedKnowledge({ event, events, artifacts: input.artifacts })));
  issues.push(...verifiedIssues.flat());
  const stalenessEvents = events.filter((event) => event.type === "knowledge.stale.detected");
  const stalenessIssues = await Promise.all(stalenessEvents.map((event) =>
    inspectKnowledgeStaleness({ event, events, artifacts: input.artifacts })));
  issues.push(...stalenessIssues.flat());
  const eventChainFailed = issues.some((item) => item.code === "event_chain_invalid");
  const candidateFailed = candidateIssues.some((items) => items.length > 0);
  const reviewFailed = reviewIssues.some((items) => items.length > 0);
  const verifiedFailed = verifiedIssues.some((items) => items.length > 0);
  const stalenessFailed = stalenessIssues.some((items) => items.length > 0);
  return {
    projectId: input.projectId,
    status: issues.length === 0 ? "healthy" : "issues",
    checks: [
      {
        checkId: "event_chain",
        status: eventChainFailed ? "failed" : "passed",
        observedCount: eventCount,
      },
      {
        checkId: "knowledge_candidates",
        status: candidateFailed ? "failed" : "passed",
        observedCount: candidateEvents.length,
      },
      {
        checkId: "knowledge_reviews",
        status: reviewFailed ? "failed" : "passed",
        observedCount: reviewEvents.length,
      },
      {
        checkId: "verified_knowledge",
        status: verifiedFailed ? "failed" : "passed",
        observedCount: verifiedEvents.length,
      },
      {
        checkId: "knowledge_staleness",
        status: stalenessFailed ? "failed" : "passed",
        observedCount: stalenessEvents.length,
      },
    ],
    issues,
  };
}
