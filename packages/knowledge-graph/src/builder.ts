import type { EventEnvelope } from "@lervo/schemas";

import {
  assertKnowledgeGraphRelationIntegrity,
  calculateKnowledgeGraphRelationId,
} from "./integrity.js";
import {
  assertKnowledgeGraphNode,
  type KnowledgeGraphNode,
  type KnowledgeGraphNodeKind,
  type KnowledgeGraphRelation,
  type KnowledgeGraphRelationType,
} from "./types.js";

export class KnowledgeGraphRelationBuilder {
  private readonly relations = new Map<string, KnowledgeGraphRelation>();

  constructor(private readonly event: EventEnvelope) {}

  node(kind: KnowledgeGraphNodeKind, id: string): KnowledgeGraphNode {
    const node = { kind, id };
    assertKnowledgeGraphNode(node);
    return node;
  }

  add(type: KnowledgeGraphRelationType, from: KnowledgeGraphNode, to: KnowledgeGraphNode): void {
    const relation: KnowledgeGraphRelation = {
      schemaVersion: 1,
      relationId: calculateKnowledgeGraphRelationId({
        projectId: this.event.projectId,
        type,
        from,
        to,
      }),
      projectId: this.event.projectId,
      type,
      from: structuredClone(from),
      to: structuredClone(to),
      evidence: {
        eventId: this.event.eventId,
        eventType: this.event.type,
        runId: this.event.runId,
        seq: this.event.seq,
      },
    };
    assertKnowledgeGraphRelationIntegrity(relation);
    this.relations.set(relation.relationId, relation);
  }

  result(): KnowledgeGraphRelation[] {
    return [...this.relations.values()]
      .sort((left, right) => left.relationId.localeCompare(right.relationId))
      .map((relation) => structuredClone(relation));
  }
}
