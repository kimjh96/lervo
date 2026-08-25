import type { EventEnvelope } from "@lervo/schemas";

import type { KnowledgeGraphRelationBuilder } from "./builder.js";
import { eventPayload, optionalText, requiredText, requiredTexts } from "./payload.js";

export function projectExecutionRelations(
  event: EventEnvelope,
  builder: KnowledgeGraphRelationBuilder,
): void {
  const payload = eventPayload(event);
  const run = builder.node("run", event.runId);
  switch (event.type) {
    case "run.completed":
      for (const id of requiredTexts(payload, "artifactIds")) {
        builder.add("produced_artifact", run, builder.node("artifact", id));
      }
      return;
    case "context.selected":
      builder.add(
        "selected_document",
        run,
        builder.node("document", requiredText(payload, "documentId")),
      );
      return;
    case "document.loaded":
      builder.add(
        "loaded_document",
        run,
        builder.node("document", requiredText(payload, "documentId")),
      );
      return;
    case "context.injected":
      for (const id of requiredTexts(payload, "documentIds")) {
        builder.add("injected_document", run, builder.node("document", id));
      }
      return;
    case "context.published": {
      const context = builder.node("shared_context", requiredText(payload, "sharedContextId"));
      builder.add("published_context", run, context);
      builder.add(
        "references_document",
        context,
        builder.node("document", requiredText(payload, "documentId")),
      );
      return;
    }
    case "handoff.created": {
      const handoff = builder.node("handoff", requiredText(payload, "handoffId"));
      builder.add("created_handoff", run, handoff);
      builder.add("from_role", handoff, builder.node("role", requiredText(payload, "fromRoleId")));
      builder.add("to_role", handoff, builder.node("role", requiredText(payload, "toRoleId")));
      for (const id of requiredTexts(payload, "sharedContextIds")) {
        builder.add("includes_context", handoff, builder.node("shared_context", id));
      }
      for (const id of requiredTexts(payload, "evidenceEventIds")) {
        builder.add("cites_event", handoff, builder.node("event", id));
      }
      return;
    }
    case "file.changed":
      builder.add(
        "changed_path",
        run,
        builder.node("repository_path", requiredText(payload, "path")),
      );
      return;
    case "verification.completed": {
      const verification = builder.node("verification", requiredText(payload, "verificationId"));
      builder.add("completed_verification", run, verification);
      builder.add(
        "produced_artifact",
        verification,
        builder.node("artifact", requiredText(payload, "resultArtifactId")),
      );
      return;
    }
    case "deliberation.started": {
      const deliberation = builder.node("deliberation", requiredText(payload, "deliberationId"));
      builder.add("started_deliberation", run, deliberation);
      for (const id of requiredTexts(payload, "participantRoleIds")) {
        builder.add("participant_role", deliberation, builder.node("role", id));
      }
      return;
    }
    case "deliberation.artifact.recorded": {
      const deliberation = builder.node("deliberation", requiredText(payload, "deliberationId"));
      const recorded = builder.node(
        "deliberation_artifact",
        requiredText(payload, "deliberationArtifactId"),
      );
      builder.add("recorded_artifact", deliberation, recorded);
      builder.add(
        "stored_as",
        recorded,
        builder.node("artifact", requiredText(payload, "artifactId")),
      );
      builder.add(
        "produced_by",
        recorded,
        builder.node("role", requiredText(payload, "producerRoleId")),
      );
      return;
    }
    case "deliberation.completed": {
      const deliberation = builder.node("deliberation", requiredText(payload, "deliberationId"));
      const outcome = builder.node("deliberation_outcome", requiredText(payload, "outcomeId"));
      builder.add("completed_with", deliberation, outcome);
      const decision = optionalText(payload, "decisionArtifactId");
      if (decision !== null) {
        builder.add("decision_artifact", outcome, builder.node("deliberation_artifact", decision));
      }
      return;
    }
    case "document.stale.detected":
      builder.add(
        "detected_stale_document",
        run,
        builder.node("document", requiredText(payload, "documentId")),
      );
  }
}
