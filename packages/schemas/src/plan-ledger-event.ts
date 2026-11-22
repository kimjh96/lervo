import { sha256Schema, timestampSchema } from "./common.js";

/**
 * ADR-0563: the plan ledger's events. The ledger is the fold of these events, so they carry the
 * whole item state. A title or reason is a short paraphrase; no event carries prompt text, a
 * transcript excerpt, or a document body.
 */
export const planLedgerEventTypes = [
  "plan.item.captured",
  "plan.item.updated",
  "plan.item.closed",
  "plan.summary.gap",
  "plan.turn.blocked",
  "plan.item.missed",
] as const;

const itemId = { type: "string", pattern: "^pli_[a-f0-9]{24}$" } as const;
const paraphrase = { type: "string", minLength: 1, maxLength: 240 } as const;
const itemIds = {
  type: "array",
  minItems: 1,
  maxItems: 64,
  uniqueItems: true,
  items: itemId,
} as const;

/** Where an item came from: a transcript position, an agent command, or a migrated workstream. */
const source = {
  type: "object",
  additionalProperties: false,
  properties: {
    origin: { enum: ["transcript", "agent_command", "workstream"] },
    provider: { anyOf: [{ enum: ["codex", "claude"] }, { type: "null" }] },
    /** sha256 of the provider session id; the id itself never leaves the host. */
    sessionDigest: { anyOf: [sha256Schema, { type: "null" }] },
    transcriptOffset: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
  },
  required: ["origin", "provider", "sessionDigest", "transcriptOffset"],
} as const;

/** What Lervo observed before it closed an item `done`. */
const evidence = {
  type: "array",
  maxItems: 16,
  items: {
    type: "object",
    additionalProperties: false,
    properties: {
      kind: { enum: ["commit", "release", "event"] },
      /** A commit id, a release tag, or an event id; never a path or free text. */
      ref: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$" },
      /** The branch a commit was reachable from when it was checked, for `commit` only. */
      branch: { anyOf: [{ type: "string", minLength: 1, maxLength: 128 }, { type: "null" }] },
    },
    required: ["kind", "ref", "branch"],
  },
} as const;

export const planItemCapturedEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    itemId,
    parentId: { anyOf: [itemId, { type: "null" }] },
    kind: { enum: ["objective", "directive", "plan", "finding"] },
    title: paraphrase,
    state: { enum: ["candidate", "open", "in_progress"] },
    source,
    occurredAt: timestampSchema,
  },
  required: ["itemId", "parentId", "kind", "title", "state", "source", "occurredAt"],
} as const;

export const planItemUpdatedEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    itemId,
    parentId: { anyOf: [itemId, { type: "null" }] },
    title: paraphrase,
    state: { enum: ["candidate", "open", "in_progress"] },
    occurredAt: timestampSchema,
  },
  required: ["itemId", "parentId", "title", "state", "occurredAt"],
} as const;

export const planItemClosedEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    itemId,
    state: { enum: ["done", "cancelled", "superseded"] },
    reason: paraphrase,
    evidence,
    supersededBy: { anyOf: [itemId, { type: "null" }] },
    occurredAt: timestampSchema,
  },
  required: ["itemId", "state", "reason", "evidence", "supersededBy", "occurredAt"],
} as const;

export const planSummaryGapEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    summaryDigest: sha256Schema,
    itemIds,
    occurredAt: timestampSchema,
  },
  required: ["summaryDigest", "itemIds", "occurredAt"],
} as const;

export const planTurnBlockedEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    turnId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$" },
    itemIds,
    attempt: { type: "integer", minimum: 1, maximum: 2 },
    occurredAt: timestampSchema,
  },
  required: ["turnId", "itemIds", "attempt", "occurredAt"],
} as const;

export const planItemMissedEventPayloadSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    itemId,
    cause: { enum: ["owner_asked", "owner_corrected"] },
    occurredAt: timestampSchema,
  },
  required: ["itemId", "cause", "occurredAt"],
} as const;
