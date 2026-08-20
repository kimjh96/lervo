import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import { eventTypes } from "@lervo/schemas";

import type {
  KnowledgeGraphNode,
  KnowledgeGraphNodeKind,
  KnowledgeGraphRelation,
  KnowledgeGraphRelationType,
} from "./types.js";
import {
  assertKnowledgeGraphNode,
  knowledgeGraphRelationTypes,
} from "./types.js";

interface RelationEndpoints {
  from: readonly KnowledgeGraphNodeKind[];
  to: readonly KnowledgeGraphNodeKind[];
}

export const knowledgeGraphRelationEndpoints: Readonly<Record<KnowledgeGraphRelationType, RelationEndpoints>> = {
  affects_path: { from: ["knowledge_candidate"], to: ["repository_path"] },
  approved_by: { from: ["knowledge"], to: ["knowledge_review"] },
  changed_path: { from: ["run", "knowledge"], to: ["repository_path"] },
  cites_event: { from: ["handoff", "knowledge_candidate"], to: ["event"] },
  completed_verification: { from: ["run"], to: ["verification"] },
  completed_with: { from: ["deliberation"], to: ["deliberation_outcome"] },
  contains_run: { from: ["project"], to: ["run"] },
  covers_path: { from: ["knowledge"], to: ["repository_path"] },
  created_candidate: { from: ["run"], to: ["knowledge_candidate"] },
  created_handoff: { from: ["run"], to: ["handoff"] },
  decision_artifact: {
    from: ["deliberation_outcome", "knowledge_candidate"],
    to: ["deliberation_artifact"],
  },
  derived_from: { from: ["knowledge_candidate"], to: ["deliberation_outcome"] },
  detected_stale: { from: ["run"], to: ["knowledge"] },
  detected_stale_document: { from: ["run"], to: ["document"] },
  from_role: { from: ["handoff"], to: ["role"] },
  includes_context: { from: ["handoff"], to: ["shared_context"] },
  injected_document: { from: ["run"], to: ["document"] },
  loaded_document: { from: ["run"], to: ["document"] },
  missing_path: { from: ["knowledge"], to: ["repository_path"] },
  participant_role: { from: ["deliberation"], to: ["role"] },
  produced_artifact: { from: ["run", "verification"], to: ["artifact"] },
  produced_by: { from: ["deliberation_artifact"], to: ["role"] },
  promoted_from: { from: ["knowledge"], to: ["knowledge_candidate"] },
  published_context: { from: ["run"], to: ["shared_context"] },
  recorded_artifact: { from: ["deliberation"], to: ["deliberation_artifact"] },
  references_document: { from: ["shared_context"], to: ["document"] },
  resolved_conflict: { from: ["knowledge_candidate"], to: ["knowledge_candidate"] },
  reviewed_by: { from: ["knowledge_candidate"], to: ["knowledge_review"] },
  selected_document: { from: ["run"], to: ["document"] },
  stale_result: { from: ["knowledge"], to: ["knowledge_staleness"] },
  started_deliberation: { from: ["run"], to: ["deliberation"] },
  stored_as: {
    from: ["deliberation_artifact", "knowledge_candidate", "knowledge"],
    to: ["artifact"],
  },
  to_role: { from: ["handoff"], to: ["role"] },
  verification_artifact: { from: ["knowledge_candidate"], to: ["deliberation_artifact"] },
  verified_knowledge: { from: ["run"], to: ["knowledge"] },
};

function validText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength &&
    !/[\u0000-\u001f\u007f]/.test(value);
}

export function calculateKnowledgeGraphRelationId(input: {
  projectId: string;
  type: KnowledgeGraphRelationType;
  from: KnowledgeGraphNode;
  to: KnowledgeGraphNode;
}): string {
  const identity = {
    projectId: input.projectId,
    type: input.type,
    from: input.from,
    to: input.to,
  };
  const digest = createHash("sha256").update(canonicalJson(identity)).digest("hex");
  return `kgr_${digest.slice(0, 16)}`;
}

export function assertKnowledgeGraphRelationIntegrity(relation: KnowledgeGraphRelation): void {
  if (relation.schemaVersion !== 1 || !validText(relation.projectId, 256) ||
    !knowledgeGraphRelationTypes.includes(relation.type)) {
    throw new Error("지식 그래프 relation 기본 좌표가 유효하지 않습니다.");
  }
  assertKnowledgeGraphNode(relation.from);
  assertKnowledgeGraphNode(relation.to);
  const endpoints = knowledgeGraphRelationEndpoints[relation.type];
  if (!endpoints.from.includes(relation.from.kind) || !endpoints.to.includes(relation.to.kind)) {
    throw new Error("지식 그래프 relation 방향과 node 종류가 맞지 않습니다.");
  }
  if (!validText(relation.evidence.eventId, 256) ||
    !eventTypes.includes(relation.evidence.eventType) ||
    !validText(relation.evidence.runId, 256) ||
    !Number.isSafeInteger(relation.evidence.seq) || relation.evidence.seq < 1) {
    throw new Error("지식 그래프 relation 증거 좌표가 유효하지 않습니다.");
  }
  if ((relation.from.kind === "project" && relation.from.id !== relation.projectId) ||
    (relation.to.kind === "project" && relation.to.id !== relation.projectId) ||
    (relation.from.kind === "run" && relation.from.id !== relation.evidence.runId) ||
    (relation.to.kind === "run" && relation.to.id !== relation.evidence.runId)) {
    throw new Error("지식 그래프 relation의 project·run node가 증거 좌표와 다릅니다.");
  }
  const expected = calculateKnowledgeGraphRelationId(relation);
  if (relation.relationId !== expected) {
    throw new Error("지식 그래프 relation ID가 명시적 관계와 다릅니다.");
  }
}
