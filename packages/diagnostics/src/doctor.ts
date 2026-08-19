import type { ArtifactStore, EventStore } from "@lervo/storage-contract";

import { inspectCandidate } from "./candidate-inspection.js";
import type { DoctorIssue, DoctorReport } from "./types.js";

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
  const eventChainFailed = issues.some((item) => item.code === "event_chain_invalid");
  const knowledgeFailed = issues.some((item) => item.code !== "event_chain_invalid");
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
        status: knowledgeFailed ? "failed" : "passed",
        observedCount: candidateEvents.length,
      },
    ],
    issues,
  };
}
