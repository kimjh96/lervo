/**
 * The result of the core link's `turn.summary` command: what the core recorded about a hosted
 * session's turns (Lervo ADE sessions, "The turn summary").
 */
import type { FromSchema } from "json-schema-to-ts";

const countSchema = { type: "integer", minimum: 0 } as const;

/**
 * One turn as the core recorded it (Lervo ADE sessions, "The turn summary"): what Lervo gave the
 * agent, what the agent's searches found and what it cited, what changed, and what the turn used.
 * Every field comes from the repository's records; a turn the core did not record is null.
 */
export const turnSummarySchema = {
  title: "TurnSummary",
  type: "object",
  required: ["given", "searched", "cited", "outcome"],
  properties: {
    /** Documents Lervo selected for the turn, and the workstream revision it gave. */
    given: {
      type: "object",
      required: ["documents"],
      properties: { documents: countSchema, workstreamRevision: countSchema },
    },
    /** Documents the agent's own Lervo searches found, with the first paths. */
    searched: {
      type: "object",
      required: ["documents", "paths"],
      properties: {
        documents: countSchema,
        paths: { type: "array", maxItems: 10, items: { type: "string", maxLength: 512 } },
      },
    },
    /** References to documents the agent's answer made, as Stop observed them. */
    cited: countSchema,
    outcome: {
      type: "object",
      required: ["repositoryChanged", "completion"],
      properties: {
        repositoryChanged: { type: "boolean" },
        changedPaths: countSchema,
        workstreamRevision: countSchema,
        /** `allowed`, `blocked`, or `not_checked`, as the turn's observation says. */
        completion: { type: "string", maxLength: 32 },
        /** How a turn without a Stop hook ended, such as `next_prompt`. */
        ending: { type: "string", maxLength: 32 },
      },
    },
    /** The provider-reported usage of the turn's results, with a list-price cost when known. */
    usage: {
      type: "object",
      required: ["inputTokens", "cachedInputTokens", "outputTokens"],
      properties: {
        inputTokens: countSchema,
        cachedInputTokens: countSchema,
        outputTokens: countSchema,
        costUsd: { type: "number", minimum: 0 },
      },
    },
  },
} as const;

/** `turn.summary`: each requested turn's summary, in the order asked, or null. */
export const turnSummaryResultSchema = {
  title: "TurnSummaryResult",
  type: "object",
  required: ["turns"],
  properties: {
    turns: {
      type: "array",
      maxItems: 20,
      items: { oneOf: [turnSummarySchema, { type: "null" }] },
    },
  },
} as const;

export type TurnSummary = FromSchema<typeof turnSummarySchema>;
export type TurnSummaryResult = FromSchema<typeof turnSummaryResultSchema>;
