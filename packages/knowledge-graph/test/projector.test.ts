import { computeEventHash } from "@lervo/event-contract";
import type { EventEnvelope, EventType } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import {
  assertKnowledgeGraphRelationIntegrity,
  calculateKnowledgeGraphRelationId,
  projectKnowledgeGraphEvent,
} from "../src/index.js";

function event(type: EventType, payload: Record<string, unknown>, seq = 1): EventEnvelope {
  const withoutHash: Omit<EventEnvelope, "eventHash"> = {
    eventId: `evt_graph_${String(seq).padStart(2, "0")}`,
    projectId: "prj_graph_projection_01",
    runId: "run_graph_projection_01",
    sessionId: "ses_graph_projection_01",
    seq,
    type,
    occurredAt: `2026-08-20T02:00:${String(seq).padStart(2, "0")}.000Z`,
    actor: { kind: "user" },
    schemaVersion: 1,
    policyVersion: `sha256:${"a".repeat(64)}`,
    payload,
    previousHash: seq === 1 ? null : `sha256:${"b".repeat(64)}`,
  };
  return { ...withoutHash, eventHash: computeEventHash(withoutHash) };
}

describe("explicit knowledge graph projection", () => {
  it("links a run, shared context and source document without copying content", () => {
    const relations = projectKnowledgeGraphEvent(
      event("context.published", {
        sharedContextId: "ctx_graph_publication_01",
        documentId: "doc_graph_source_01",
        contentHash: `sha256:${"c".repeat(64)}`,
        producerRoleId: "researcher",
        audienceMode: "project",
        allowedRoleIds: [],
        expiresAt: null,
      }),
    );

    expect(relations.map((relation) => relation.type)).toEqual(
      ["references_document", "published_context", "contains_run"].sort((left, right) => {
        const leftId = relations.find((item) => item.type === left)!.relationId;
        const rightId = relations.find((item) => item.type === right)!.relationId;
        return leftId.localeCompare(rightId);
      }),
    );
    expect(relations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "references_document",
          from: { kind: "shared_context", id: "ctx_graph_publication_01" },
          to: { kind: "document", id: "doc_graph_source_01" },
        }),
      ]),
    );
    expect(JSON.stringify(relations)).not.toContain("contentHash");
    for (const relation of relations) {
      expect(() => assertKnowledgeGraphRelationIntegrity(relation)).not.toThrow();
    }
  });

  it("projects candidate evidence, decision, verification and paths as separate relations", () => {
    const relations = projectKnowledgeGraphEvent(
      event("knowledge.candidate.created", {
        candidateId: "knc_aaaaaaaaaaaaaaaa",
        claimDigest: `sha256:${"c".repeat(64)}`,
        paths: ["src/graph.ts", "docs/graph.md"],
        evidenceIds: ["evt_evidence_01", "evt_evidence_02"],
        sourceOutcomeId: "dlo_aaaaaaaaaaaaaaaa",
        decisionArtifactId: "dla_aaaaaaaaaaaaaaaa",
        verificationArtifactIds: ["dla_bbbbbbbbbbbbbbbb"],
        verifiedRevision: `sha256:${"d".repeat(64)}`,
        candidateArtifactId: "art_candidate_graph_01",
        candidateContentHash: `sha256:${"e".repeat(64)}`,
      }),
    );

    expect(relations.filter((relation) => relation.type === "affects_path")).toHaveLength(2);
    expect(relations.filter((relation) => relation.type === "cites_event")).toHaveLength(2);
    expect(relations.map((relation) => relation.type)).toEqual(
      expect.arrayContaining([
        "contains_run",
        "created_candidate",
        "derived_from",
        "decision_artifact",
        "verification_artifact",
        "stored_as",
      ]),
    );
  });

  it("keeps relation identity stable while evidence coordinates change", () => {
    const first = projectKnowledgeGraphEvent(
      event(
        "context.selected",
        {
          documentId: "doc_graph_source_01",
        },
        1,
      ),
    );
    const later = projectKnowledgeGraphEvent(
      event(
        "context.selected",
        {
          documentId: "doc_graph_source_01",
        },
        2,
      ),
    );
    const firstSelected = first.find((relation) => relation.type === "selected_document")!;
    const laterSelected = later.find((relation) => relation.type === "selected_document")!;

    expect(firstSelected.relationId).toBe(laterSelected.relationId);
    expect(firstSelected.evidence.seq).toBe(1);
    expect(laterSelected.evidence.seq).toBe(2);
  });

  it("fails instead of inventing a relation from a missing explicit coordinate", () => {
    expect(() => projectKnowledgeGraphEvent(event("context.selected", {}))).toThrow(/documentId/);
  });

  it("rejects a relation whose controlled type connects the wrong node kinds", () => {
    const relation = projectKnowledgeGraphEvent(
      event("context.selected", {
        documentId: "doc_graph_source_01",
      }),
    ).find((item) => item.type === "selected_document")!;
    const invalid = {
      ...relation,
      from: { kind: "document" as const, id: "doc_wrong_endpoint_01" },
    };
    invalid.relationId = calculateKnowledgeGraphRelationId(invalid);

    expect(() => assertKnowledgeGraphRelationIntegrity(invalid)).toThrow(/node kinds/);
  });

  it("rejects unsafe repository paths before they enter a relation", () => {
    expect(() =>
      projectKnowledgeGraphEvent(
        event("file.changed", {
          path: "../outside-project.txt",
        }),
      ),
    ).toThrow(/node coordinates/);
  });
});
