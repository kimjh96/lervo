/**
 * What a provider's decoder reports through the core link: the events it decoded from the
 * provider's stream and the conversation content they carry. `decoder.decoded` and
 * `transcript.page` answer with them.
 */
import type { FromSchema } from "json-schema-to-ts";

import { imageMarksSchema } from "./image.js";
import { codeSchema, epochMillisecondsSchema, parametersSchema } from "./primitives.js";
import { toolDetailSchema } from "./tool-detail.js";
import { choicesSchema } from "./choices.js";

const textSchema = { type: "string", maxLength: 262144 } as const;

const textContent = <Title extends string, Kind extends string>(title: Title, kind: Kind) =>
  ({
    title,
    type: "object",
    additionalProperties: false,
    required: ["kind", "text"],
    properties: { kind: { type: "string", enum: [kind] }, text: textSchema },
  }) as const;

export const decodedContentSchemas = [
  {
    title: "UserMessageContent",
    type: "object",
    additionalProperties: false,
    required: ["kind", "text"],
    properties: {
      kind: { type: "string", enum: ["user_message"] },
      text: textSchema,
      images: imageMarksSchema,
    },
  },
  textContent("AgentMessageContent", "agent_message"),
  {
    title: "QuestionContent",
    type: "object",
    additionalProperties: false,
    required: ["kind", "text"],
    properties: {
      kind: { type: "string", enum: ["question"] },
      text: textSchema,
      choices: choicesSchema,
    },
  },
  {
    title: "ToolActivityContent",
    type: "object",
    additionalProperties: false,
    required: ["kind", "name", "status", "calls"],
    properties: {
      kind: { type: "string", enum: ["tool_activity"] },
      name: { type: "string", minLength: 1, maxLength: 64 },
      status: { type: "string", enum: ["running", "succeeded", "failed"] },
      calls: { type: "integer", minimum: 1 },
      detail: toolDetailSchema,
    },
  },
  {
    title: "PeerMessageContent",
    type: "object",
    additionalProperties: false,
    required: ["kind", "from", "text"],
    properties: {
      kind: { type: "string", enum: ["peer_message"] },
      from: { type: "string", minLength: 1, maxLength: 128 },
      text: textSchema,
    },
  },
  {
    title: "LervoNoticeContent",
    type: "object",
    additionalProperties: false,
    required: ["kind", "code", "parameters"],
    properties: {
      kind: { type: "string", enum: ["lervo_notice"] },
      code: codeSchema,
      parameters: parametersSchema,
    },
  },
] as const;

export const decodedContentSchema = {
  title: "DecodedContent",
  oneOf: decodedContentSchemas,
} as const;

/** What a provider adapter decoded, in the order the session host applies it. */
export const decodedEventSchemas = [
  {
    title: "DecodedStatus",
    type: "object",
    additionalProperties: false,
    required: ["kind", "event"],
    properties: {
      kind: { type: "string", enum: ["status"] },
      event: { type: "string", enum: ["turn_started", "question_asked", "turn_finished"] },
    },
  },
  {
    title: "DecodedItem",
    type: "object",
    additionalProperties: false,
    required: ["kind", "content", "createdAtMs"],
    properties: {
      kind: { type: "string", enum: ["item"] },
      content: decodedContentSchema,
      createdAtMs: epochMillisecondsSchema,
    },
  },
  {
    title: "DecodedStart",
    type: "object",
    additionalProperties: false,
    required: ["kind", "content", "createdAtMs"],
    properties: {
      kind: { type: "string", enum: ["start"] },
      content: decodedContentSchema,
      createdAtMs: epochMillisecondsSchema,
    },
  },
  {
    title: "DecodedDelta",
    type: "object",
    additionalProperties: false,
    required: ["kind", "text"],
    properties: { kind: { type: "string", enum: ["delta"] }, text: textSchema },
  },
  {
    title: "DecodedFinish",
    type: "object",
    additionalProperties: false,
    required: ["kind"],
    properties: { kind: { type: "string", enum: ["finish"] } },
  },
] as const;

export const decodedEventSchema = { title: "DecodedEvent", oneOf: decodedEventSchemas } as const;

export type DecodedEvent = FromSchema<typeof decodedEventSchema>;
export type DecodedContent = FromSchema<typeof decodedContentSchema>;
