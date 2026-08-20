import type { EventEnvelope } from "@lervo/schemas";

import { KnowledgeGraphRelationBuilder } from "./builder.js";
import { projectExecutionRelations } from "./execution-projector.js";
import { projectKnowledgeRelations } from "./knowledge-projector.js";
import type { KnowledgeGraphRelation } from "./types.js";

export function projectKnowledgeGraphEvent(event: EventEnvelope): KnowledgeGraphRelation[] {
  const builder = new KnowledgeGraphRelationBuilder(event);
  builder.add(
    "contains_run",
    builder.node("project", event.projectId),
    builder.node("run", event.runId),
  );
  projectExecutionRelations(event, builder);
  projectKnowledgeRelations(event, builder);
  return builder.result();
}
