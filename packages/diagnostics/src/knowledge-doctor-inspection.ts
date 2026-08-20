import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

import { inspectCandidate } from "./candidate-inspection.js";
import { inspectKnowledgeReview } from "./review-inspection.js";
import { inspectKnowledgeStaleness } from "./staleness-inspection.js";
import type { DoctorIssue, DoctorReport } from "./types.js";
import { inspectVerifiedKnowledge } from "./verified-inspection.js";

export async function inspectDoctorKnowledge(input: {
  events: EventStore;
  artifacts: ArtifactStore;
}): Promise<{ checks: DoctorReport["checks"]; issues: DoctorIssue[] }> {
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
    inspectCandidate({ event, events, artifacts: input.artifacts })));
  const reviewEvents = events.filter((event) => event.type === "knowledge.candidate.reviewed");
  const reviewIssues = await Promise.all(reviewEvents.map((event) =>
    inspectKnowledgeReview({ event, events, artifacts: input.artifacts })));
  const verifiedEvents = events.filter((event) => event.type === "knowledge.verified");
  const verifiedIssues = await Promise.all(verifiedEvents.map((event) =>
    inspectVerifiedKnowledge({ event, events, artifacts: input.artifacts })));
  const stalenessEvents = events.filter((event) => event.type === "knowledge.stale.detected");
  const stalenessIssues = await Promise.all(stalenessEvents.map((event) =>
    inspectKnowledgeStaleness({ event, events, artifacts: input.artifacts })));
  issues.push(
    ...candidateIssues.flat(),
    ...reviewIssues.flat(),
    ...verifiedIssues.flat(),
    ...stalenessIssues.flat(),
  );
  return {
    checks: [
      {
        checkId: "event_chain",
        status: issues.some((item) => item.code === "event_chain_invalid")
          ? "unhealthy"
          : "healthy",
        observedCount: eventCount,
      },
      {
        checkId: "knowledge_candidates",
        status: candidateIssues.some((items) => items.length > 0) ? "unhealthy" : "healthy",
        observedCount: candidateEvents.length,
      },
      {
        checkId: "knowledge_reviews",
        status: reviewIssues.some((items) => items.length > 0) ? "unhealthy" : "healthy",
        observedCount: reviewEvents.length,
      },
      {
        checkId: "verified_knowledge",
        status: verifiedIssues.some((items) => items.length > 0) ? "unhealthy" : "healthy",
        observedCount: verifiedEvents.length,
      },
      {
        checkId: "knowledge_staleness",
        status: stalenessIssues.some((items) => items.length > 0) ? "unhealthy" : "healthy",
        observedCount: stalenessEvents.length,
      },
    ],
    issues,
  };
}
