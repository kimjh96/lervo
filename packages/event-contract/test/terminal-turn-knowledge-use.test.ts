import { expect, it } from "vitest";
import { sanitizeEventPayload } from "../src/redaction.js";

const hash = `sha256:${"a".repeat(64)}`;
const contextEventId = "evt_turnknowledge01";
const prepared = {
  observationId: "tobs_turnknowledge01",
  executionMode: "unmanaged",
  providerSessionDigest: hash,
  providerTurnDigest: null,
  sourceSnapshotId: `ksnap_${"a".repeat(24)}`,
  queryDigest: hash,
  contextHash: hash,
  recommendationCount: 0,
  loadedDocuments: [],
};
const observed = {
  observationId: "tobs_turnknowledge02",
  contextEventId,
  referenceEventIds: [],
  referenceCount: 0,
  referenceTelemetry: "observed",
  lifecycleStatus: "current",
  completionResult: "allowed",
  providerSessionDigest: hash,
  providerTurnDigest: null,
};
const selection = {
  documentId: "doc_path_0123456789abcdef01234567",
  path: "docs/decision.md",
  contentHash: hash,
  origin: "agent_query",
  contextEventId,
  providerSessionDigest: hash,
  providerTurnDigest: null,
};

it("retains historical terminal payloads and accepts bounded pointer and paired count additions", () => {
  expect(sanitizeEventPayload("terminal.context.prepared", prepared).payload).toEqual(prepared);
  expect(sanitizeEventPayload("terminal.turn.observed", observed).payload).toEqual(observed);
  const current = {
    ...prepared,
    selectedPointers: [{ path: "docs/decision.md", contentHash: hash, kind: "decision" }],
  };
  expect(
    sanitizeEventPayload("terminal.context.prepared", { ...current, prompt: "private prompt" })
      .payload,
  ).toEqual(current);
  expect(() =>
    sanitizeEventPayload("terminal.context.prepared", {
      ...current,
      selectedPointers: Array(4).fill(current.selectedPointers[0]),
    }),
  ).toThrow();
  expect(() =>
    sanitizeEventPayload("terminal.context.prepared", {
      ...current,
      selectedPointers: [{ ...current.selectedPointers[0], path: "/private/decision.md" }],
    }),
  ).toThrow();
  const counts = { ...observed, selectedCount: 1, pathMentionCount: 0 };
  expect(sanitizeEventPayload("terminal.turn.observed", counts).payload).toEqual(counts);
  expect(() =>
    sanitizeEventPayload("terminal.turn.observed", { ...observed, selectedCount: 1 }),
  ).toThrow();
  expect(() =>
    sanitizeEventPayload("terminal.turn.observed", { ...observed, pathMentionCount: 1 }),
  ).toThrow();
  const many = {
    ...counts,
    selectedCount: 20,
    referenceCount: 20,
    pathMentionCount: 20,
    referenceEventIds: Array.from(
      { length: 20 },
      (_, index) => `evt_reference_${index.toString().padStart(8, "0")}`,
    ),
  };
  expect(sanitizeEventPayload("terminal.turn.observed", many).payload).toEqual(many);
});

it("accepts historical selection origins and rejects incomplete agent-query binding groups", () => {
  const historical = {
    documentId: "doc_selection_01",
    reasonCode: "path_rule",
    ruleId: "rule_selection_01",
    required: true,
    scope: "project",
  };
  expect(sanitizeEventPayload("context.selected", historical).payload).toEqual(historical);
  for (const origin of ["hook", "managed_turn"])
    expect(sanitizeEventPayload("context.selected", { ...historical, origin }).payload).toEqual({
      ...historical,
      origin,
    });
  expect(
    sanitizeEventPayload("context.selected", {
      ...selection,
      query: "private query",
      prompt: "private prompt",
      reply: "private reply",
    }).payload,
  ).toEqual(selection);
  for (const field of [
    "documentId",
    "path",
    "contentHash",
    "contextEventId",
    "providerSessionDigest",
    "providerTurnDigest",
  ]) {
    const partial: Record<string, unknown> = { ...selection };
    delete partial[field];
    expect(() => sanitizeEventPayload("context.selected", partial)).toThrow();
  }
  expect(() =>
    sanitizeEventPayload("context.selected", { ...selection, origin: "managed_turn" }),
  ).toThrow();
  expect(() =>
    sanitizeEventPayload("context.selected", { ...selection, path: "../outside.md" }),
  ).toThrow();
});

it("retains output citations and admits path mentions with path-derived document identity", () => {
  const common = {
    observationId: "tobs_reference0001",
    contextEventId,
    path: selection.path,
    contentHash: hash,
    scope: "full",
    providerSessionDigest: hash,
    providerTurnDigest: null,
  };
  const token = {
    ...common,
    conceptId: `concept_${"b".repeat(24)}`,
    referenceKind: "output_citation",
  };
  const mention = { ...common, documentId: selection.documentId, referenceKind: "path_mention" };
  expect(sanitizeEventPayload("terminal.reference.observed", token).payload).toEqual(token);
  expect(
    sanitizeEventPayload("terminal.reference.observed", {
      ...mention,
      lastAssistantMessage: "private reply",
    }).payload,
  ).toEqual(mention);
  expect(() =>
    sanitizeEventPayload("terminal.reference.observed", {
      ...common,
      referenceKind: "path_mention",
    }),
  ).toThrow();
});
