import type { EventEnvelope } from "@lervo/schemas";

import type { KnowledgeGraphRelationBuilder } from "./builder.js";
import { eventPayload, requiredText, requiredTexts } from "./payload.js";

export function projectKnowledgeRelations(
  event: EventEnvelope,
  builder: KnowledgeGraphRelationBuilder,
): void {
  const payload = eventPayload(event);
  const run = builder.node("run", event.runId);
  switch (event.type) {
    case "knowledge.candidate.created": {
      const candidate = builder.node("knowledge_candidate", requiredText(payload, "candidateId"));
      builder.add("created_candidate", run, candidate);
      builder.add(
        "derived_from",
        candidate,
        builder.node("deliberation_outcome", requiredText(payload, "sourceOutcomeId")),
      );
      builder.add(
        "decision_artifact",
        candidate,
        builder.node("deliberation_artifact", requiredText(payload, "decisionArtifactId")),
      );
      builder.add(
        "stored_as",
        candidate,
        builder.node("artifact", requiredText(payload, "candidateArtifactId")),
      );
      for (const id of requiredTexts(payload, "evidenceIds")) {
        builder.add("cites_event", candidate, builder.node("event", id));
      }
      for (const id of requiredTexts(payload, "verificationArtifactIds")) {
        builder.add("verification_artifact", candidate, builder.node("deliberation_artifact", id));
      }
      for (const path of requiredTexts(payload, "paths")) {
        builder.add("affects_path", candidate, builder.node("repository_path", path));
      }
      return;
    }
    case "knowledge.candidate.reviewed": {
      const candidate = builder.node("knowledge_candidate", requiredText(payload, "candidateId"));
      builder.add(
        "reviewed_by",
        candidate,
        builder.node("knowledge_review", requiredText(payload, "approvalId")),
      );
      for (const id of requiredTexts(payload, "resolvedConflictCandidateIds")) {
        builder.add("resolved_conflict", candidate, builder.node("knowledge_candidate", id));
      }
      return;
    }
    case "knowledge.verified": {
      const knowledge = builder.node("knowledge", requiredText(payload, "knowledgeId"));
      builder.add("verified_knowledge", run, knowledge);
      builder.add(
        "promoted_from",
        knowledge,
        builder.node("knowledge_candidate", requiredText(payload, "candidateId")),
      );
      builder.add(
        "approved_by",
        knowledge,
        builder.node("knowledge_review", requiredText(payload, "approvalId")),
      );
      builder.add(
        "stored_as",
        knowledge,
        builder.node("artifact", requiredText(payload, "knowledgeArtifactId")),
      );
      for (const path of requiredTexts(payload, "paths")) {
        builder.add("covers_path", knowledge, builder.node("repository_path", path));
      }
      return;
    }
    case "knowledge.stale.detected": {
      const knowledge = builder.node("knowledge", requiredText(payload, "knowledgeId"));
      builder.add("detected_stale", run, knowledge);
      builder.add(
        "stale_result",
        knowledge,
        builder.node("knowledge_staleness", requiredText(payload, "resultId")),
      );
      for (const path of requiredTexts(payload, "changedPaths")) {
        builder.add("changed_path", knowledge, builder.node("repository_path", path));
      }
      for (const path of requiredTexts(payload, "missingPaths")) {
        builder.add("missing_path", knowledge, builder.node("repository_path", path));
      }
    }
  }
}
