import type { FromSchema } from "json-schema-to-ts";

import {
  codeSchema,
  epochMillisecondsSchema,
  identifierSchema,
  parametersSchema,
  sequenceSchema,
} from "./primitives.js";
import { imageMarksSchema } from "./image.js";
import { toolDetailSchema } from "./tool-detail.js";
import { choicesSchema } from "./choices.js";

const itemStateSchema = { enum: ["streaming", "complete"] } as const;
const conversationTextSchema = { type: "string", maxLength: 262144 } as const;

function textItemSchema<Title extends string, Kind extends string>(title: Title, kind: Kind) {
  return {
    title,
    type: "object",
    additionalProperties: false,
    required: ["kind", "itemId", "createdAtMs", "state", "text"],
    properties: {
      kind: { type: "string", enum: [kind] },
      itemId: identifierSchema,
      createdAtMs: epochMillisecondsSchema,
      state: itemStateSchema,
      text: conversationTextSchema,
    },
  } as const;
}

/** The user's message, with what the conversation keeps of the images it carried. */
export const userMessageItemSchema = {
  title: "UserMessageItem",
  type: "object",
  additionalProperties: false,
  required: ["kind", "itemId", "createdAtMs", "state", "text"],
  properties: {
    kind: { type: "string", enum: ["user_message"] },
    itemId: identifierSchema,
    createdAtMs: epochMillisecondsSchema,
    state: itemStateSchema,
    text: conversationTextSchema,
    images: imageMarksSchema,
  },
} as const;
export const agentMessageItemSchema = textItemSchema("AgentMessageItem", "agent_message");
/** The agent's question, with its choices when the person can answer it in the interface. */
export const questionItemSchema = {
  title: "QuestionItem",
  type: "object",
  additionalProperties: false,
  required: ["kind", "itemId", "createdAtMs", "state", "text"],
  properties: {
    kind: { type: "string", enum: ["question"] },
    itemId: identifierSchema,
    createdAtMs: epochMillisecondsSchema,
    state: itemStateSchema,
    text: conversationTextSchema,
    choices: choicesSchema,
  },
} as const;

/** A message another agent session sent this one, such as through Claude Code's SendMessage. */
export const peerMessageItemSchema = {
  title: "PeerMessageItem",
  type: "object",
  additionalProperties: false,
  required: ["kind", "itemId", "createdAtMs", "state", "from", "text"],
  properties: {
    kind: { type: "string", enum: ["peer_message"] },
    itemId: identifierSchema,
    createdAtMs: epochMillisecondsSchema,
    state: { type: "string", enum: ["complete"] },
    /** The sending session's name, as the provider reported it. */
    from: { type: "string", minLength: 1, maxLength: 128 },
    text: conversationTextSchema,
  },
} as const;

/**
 * One tool call: its name and status, and a bounded detail of what it acted on and showed. The
 * full input and output stay in the provider's transcript.
 */
export const toolActivityItemSchema = {
  title: "ToolActivityItem",
  type: "object",
  additionalProperties: false,
  required: ["kind", "itemId", "createdAtMs", "state", "tool"],
  properties: {
    kind: { type: "string", enum: ["tool_activity"] },
    itemId: identifierSchema,
    createdAtMs: epochMillisecondsSchema,
    state: itemStateSchema,
    tool: {
      type: "object",
      additionalProperties: false,
      required: ["name", "status", "calls"],
      properties: {
        name: { type: "string", minLength: 1, maxLength: 64 },
        status: { enum: ["running", "succeeded", "failed"] },
        calls: { type: "integer", minimum: 1 },
        detail: toolDetailSchema,
      },
    },
  },
} as const;

/** A Lervo notice is a code with parameters; the interface renders it from its catalog. */
export const lervoNoticeItemSchema = {
  title: "LervoNoticeItem",
  type: "object",
  additionalProperties: false,
  required: ["kind", "itemId", "createdAtMs", "state", "code", "parameters"],
  properties: {
    kind: { type: "string", enum: ["lervo_notice"] },
    itemId: identifierSchema,
    createdAtMs: epochMillisecondsSchema,
    state: { type: "string", enum: ["complete"] },
    code: codeSchema,
    parameters: parametersSchema,
  },
} as const;

export const conversationItemSchemas = [
  userMessageItemSchema,
  agentMessageItemSchema,
  toolActivityItemSchema,
  questionItemSchema,
  lervoNoticeItemSchema,
  peerMessageItemSchema,
] as const;

export const conversationItemSchema = {
  title: "ConversationItem",
  oneOf: conversationItemSchemas,
} as const;

const itemListSchema = { type: "array", maxItems: 200, items: conversationItemSchema } as const;

export const conversationRangeMessageSchema = {
  title: "ConversationRangeMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId", "direction", "limit"],
  properties: {
    kind: { type: "string", enum: ["conversation.range"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
    direction: { enum: ["before", "after"] },
    anchorItemId: identifierSchema,
    limit: { type: "integer", minimum: 1, maximum: 200 },
  },
} as const;

export const conversationAppendedMessageSchema = {
  title: "ConversationAppendedMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "sessionId", "sequence", "items"],
  properties: {
    kind: { type: "string", enum: ["conversation.appended"] },
    sessionId: identifierSchema,
    sequence: sequenceSchema,
    items: itemListSchema,
  },
} as const;

export const conversationDeltaMessageSchema = {
  title: "ConversationDeltaMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "sessionId", "sequence", "itemId", "append"],
  properties: {
    kind: { type: "string", enum: ["conversation.delta"] },
    sessionId: identifierSchema,
    sequence: sequenceSchema,
    itemId: identifierSchema,
    append: { type: "string", minLength: 1, maxLength: 65536 },
  },
} as const;

export const conversationPageMessageSchema = {
  title: "ConversationPageMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId", "items", "hasEarlier", "hasLater"],
  properties: {
    kind: { type: "string", enum: ["conversation.page"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
    items: itemListSchema,
    hasEarlier: { type: "boolean" },
    hasLater: { type: "boolean" },
    /**
     * True when the session does not run and the page comes from the index it left (ADE
     * sessions, "Reopening a conversation"). The conversation can show it at once, and the
     * session must open before it streams. Absent from a running session's page.
     */
    stored: { type: "boolean" },
  },
} as const;

export type ConversationItem = FromSchema<typeof conversationItemSchema>;
export type ConversationRangeMessage = FromSchema<typeof conversationRangeMessageSchema>;
export type ConversationAppendedMessage = FromSchema<typeof conversationAppendedMessageSchema>;
export type ConversationDeltaMessage = FromSchema<typeof conversationDeltaMessageSchema>;
export type ConversationPageMessage = FromSchema<typeof conversationPageMessageSchema>;
