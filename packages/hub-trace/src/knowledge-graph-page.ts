import {
  assertKnowledgeGraphRelationIntegrity,
  sameKnowledgeGraphNode,
} from "@lervo/knowledge-graph";

import { HubTraceError } from "./errors.js";
import type {
  HubProjectKnowledgeGraph,
  ResolvedHubKnowledgeGraphQuery,
} from "./types.js";

export function assertKnowledgeGraphPage(input: {
  query: ResolvedHubKnowledgeGraphQuery;
  result: HubProjectKnowledgeGraph;
}): void {
  const { query, result } = input;
  if (!Array.isArray(result.relations.items) || result.relations.items.length > query.limit ||
    (result.relations.items.length === 0 && result.relations.nextCursor !== null)) {
    throw new HubTraceError(
      "source_inconsistent",
      "The Hub knowledge graph source did not satisfy the bounded-page contract.",
    );
  }
  if (result.project.destinationId !== query.destinationId ||
    result.project.projectId !== query.projectId ||
    !sameKnowledgeGraphNode(result.focus, query.focus)) {
    throw new HubTraceError("source_inconsistent", "The Hub knowledge graph coordinates differ from the request.");
  }
  let previous = query.after?.relationId ?? "";
  const seen = new Set<string>();
  for (const relation of result.relations.items) {
    try {
      assertKnowledgeGraphRelationIntegrity(relation);
    } catch {
      throw new HubTraceError("source_inconsistent", "A Hub knowledge graph relation ID is invalid.");
    }
    if (relation.projectId !== query.projectId ||
      (!sameKnowledgeGraphNode(relation.from, query.focus) &&
        !sameKnowledgeGraphNode(relation.to, query.focus)) ||
      relation.relationId <= previous || seen.has(relation.relationId)) {
      throw new HubTraceError("source_inconsistent", "The Hub knowledge graph source did not satisfy the focus and ordering contract.");
    }
    previous = relation.relationId;
    seen.add(relation.relationId);
  }
  if (result.relations.nextCursor !== null &&
    result.relations.nextCursor.relationId !== previous) {
    throw new HubTraceError("source_inconsistent", "The Hub knowledge graph cursor differs from the end of the page.");
  }
}
