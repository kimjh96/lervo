import type { EventType } from "@lervo/schemas";

export const knowledgeGraphNodeKinds = [
  "artifact",
  "deliberation",
  "deliberation_artifact",
  "deliberation_outcome",
  "document",
  "event",
  "handoff",
  "knowledge",
  "knowledge_candidate",
  "knowledge_review",
  "knowledge_staleness",
  "project",
  "repository_path",
  "role",
  "run",
  "shared_context",
  "verification",
] as const;

export const knowledgeGraphRelationTypes = [
  "affects_path",
  "approved_by",
  "changed_path",
  "cites_event",
  "completed_verification",
  "completed_with",
  "contains_run",
  "covers_path",
  "created_candidate",
  "created_handoff",
  "decision_artifact",
  "derived_from",
  "detected_stale",
  "detected_stale_document",
  "from_role",
  "includes_context",
  "injected_document",
  "loaded_document",
  "missing_path",
  "participant_role",
  "produced_artifact",
  "produced_by",
  "promoted_from",
  "published_context",
  "recorded_artifact",
  "references_document",
  "resolved_conflict",
  "reviewed_by",
  "selected_document",
  "stale_result",
  "started_deliberation",
  "stored_as",
  "to_role",
  "verification_artifact",
  "verified_knowledge",
] as const;

export type KnowledgeGraphNodeKind = (typeof knowledgeGraphNodeKinds)[number];
export type KnowledgeGraphRelationType = (typeof knowledgeGraphRelationTypes)[number];

export interface KnowledgeGraphNode {
  kind: KnowledgeGraphNodeKind;
  id: string;
}

export interface KnowledgeGraphRelationEvidence {
  eventId: string;
  eventType: EventType;
  runId: string;
  seq: number;
}

export interface KnowledgeGraphRelation {
  schemaVersion: 1;
  relationId: string;
  projectId: string;
  type: KnowledgeGraphRelationType;
  from: KnowledgeGraphNode;
  to: KnowledgeGraphNode;
  evidence: KnowledgeGraphRelationEvidence;
}

export class KnowledgeGraphContractError extends Error {
  constructor(
    readonly code: "invalid_node" | "projection_invalid",
    message: string,
  ) {
    super(message);
    this.name = "KnowledgeGraphContractError";
  }
}

function isSafeRepositoryPath(value: string): boolean {
  if (value === ".") return true;
  return (
    !value.startsWith("/") &&
    !/^[A-Za-z]:/.test(value) &&
    !value.includes("\\") &&
    !value.endsWith("/") &&
    value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
  );
}

export function assertKnowledgeGraphNode(node: KnowledgeGraphNode): void {
  if (
    !knowledgeGraphNodeKinds.includes(node.kind) ||
    typeof node.id !== "string" ||
    node.id.length < 1 ||
    node.id.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(node.id) ||
    (node.kind === "repository_path" && !isSafeRepositoryPath(node.id))
  ) {
    throw new KnowledgeGraphContractError(
      "invalid_node",
      "The knowledge graph node coordinates are invalid.",
    );
  }
}

export function sameKnowledgeGraphNode(
  left: KnowledgeGraphNode,
  right: KnowledgeGraphNode,
): boolean {
  return left.kind === right.kind && left.id === right.id;
}
