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
      "Hub knowledge graph source가 bounded page 계약을 지키지 않았습니다.",
    );
  }
  if (result.project.destinationId !== query.destinationId ||
    result.project.projectId !== query.projectId ||
    !sameKnowledgeGraphNode(result.focus, query.focus)) {
    throw new HubTraceError("source_inconsistent", "Hub knowledge graph 좌표가 요청과 다릅니다.");
  }
  let previous = query.after?.relationId ?? "";
  const seen = new Set<string>();
  for (const relation of result.relations.items) {
    try {
      assertKnowledgeGraphRelationIntegrity(relation);
    } catch {
      throw new HubTraceError("source_inconsistent", "Hub knowledge graph relation ID가 유효하지 않습니다.");
    }
    if (relation.projectId !== query.projectId ||
      (!sameKnowledgeGraphNode(relation.from, query.focus) &&
        !sameKnowledgeGraphNode(relation.to, query.focus)) ||
      relation.relationId <= previous || seen.has(relation.relationId)) {
      throw new HubTraceError("source_inconsistent", "Hub knowledge graph source가 focus·순서 계약을 지키지 않았습니다.");
    }
    previous = relation.relationId;
    seen.add(relation.relationId);
  }
  if (result.relations.nextCursor !== null &&
    result.relations.nextCursor.relationId !== previous) {
    throw new HubTraceError("source_inconsistent", "Hub knowledge graph cursor가 page 끝과 다릅니다.");
  }
}
