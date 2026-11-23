/**
 * The core link: messages between the session host and the resident Lervo application process,
 * which the session host runs as its child and reaches over the child's standard streams, one
 * JSON message per line. The session host asks; the core answers each request by its `id`.
 */
import type { FromSchema } from "json-schema-to-ts";

import { applicationCommandNames, providerIdSchema } from "./application-results.js";
import {
  codeSchema,
  epochMillisecondsSchema,
  identifierSchema,
  parametersSchema,
} from "./primitives.js";
import { conversationModeSchema } from "./session.js";

const requestIdSchema = { type: "integer", minimum: 1 } as const;
const textSchema = { type: "string", maxLength: 262144 } as const;

function request<
  const Title extends string,
  const Kind extends string,
  const Properties extends Record<string, unknown>,
  const Required extends readonly string[],
>(title: Title, kind: Kind, properties: Properties, required: Required) {
  return {
    title,
    type: "object",
    additionalProperties: false,
    required: ["kind", "id", ...required],
    properties: { kind: { type: "string", enum: [kind] }, id: requestIdSchema, ...properties },
  } as const;
}

export const coreCommandRequestSchema = request(
  "CoreCommandRequest",
  "core.command",
  {
    command: { type: "string", enum: applicationCommandNames },
    arguments: { type: "object", maxProperties: 16 },
  },
  ["command", "arguments"],
);

export const coreOpenRequestSchema = request(
  "CoreOpenRequest",
  "core.open",
  { workspaceId: identifierSchema, mode: conversationModeSchema },
  ["workspaceId"],
);

export const decoderOpenRequestSchema = request(
  "DecoderOpenRequest",
  "decoder.open",
  { decoderId: identifierSchema, provider: providerIdSchema },
  ["decoderId", "provider"],
);

export const decoderSendRequestSchema = request(
  "DecoderSendRequest",
  "decoder.send",
  { decoderId: identifierSchema, text: textSchema },
  ["decoderId", "text"],
);

/** Provider output as Base64, because a chunk may end inside a character. */
export const decoderOutputRequestSchema = request(
  "DecoderOutputRequest",
  "decoder.output",
  { decoderId: identifierSchema, data: { type: "string", maxLength: 1398104 } },
  ["decoderId", "data"],
);

export const decoderCloseRequestSchema = request(
  "DecoderCloseRequest",
  "decoder.close",
  { decoderId: identifierSchema },
  ["decoderId"],
);

/**
 * A page of the provider's own transcript of a workspace's session, which the session host
 * rebuilds the native conversation's index from. The session host sends it only for a launch the
 * core marked with `transcript`, so an older core never receives it.
 */
export const transcriptReadRequestSchema = request(
  "TranscriptReadRequest",
  "transcript.read",
  {
    workspaceId: identifierSchema,
    offset: { type: "integer", minimum: 0 },
    limit: { type: "integer", minimum: 1, maximum: 500 },
  },
  ["workspaceId", "offset", "limit"],
);

export const coreLinkRequestSchemas = [
  coreCommandRequestSchema,
  coreOpenRequestSchema,
  transcriptReadRequestSchema,
  decoderOpenRequestSchema,
  decoderSendRequestSchema,
  decoderOutputRequestSchema,
  decoderCloseRequestSchema,
] as const;

export const coreLinkRequestSchema = {
  title: "CoreLinkRequest",
  oneOf: coreLinkRequestSchemas,
} as const;

/** The process a hosted session runs, as the provider's adapter prepared it. */
export const coreLaunchSchema = {
  title: "CoreLaunch",
  type: "object",
  additionalProperties: false,
  required: [
    "sessionId",
    "workspaceId",
    "conversationMode",
    "provider",
    "program",
    "arguments",
    "environment",
    "workingDirectory",
    "initialInput",
  ],
  properties: {
    sessionId: identifierSchema,
    workspaceId: identifierSchema,
    conversationMode: conversationModeSchema,
    provider: providerIdSchema,
    program: { type: "string", minLength: 1, maxLength: 4096 },
    arguments: { type: "array", maxItems: 256, items: { type: "string", maxLength: 262144 } },
    environment: {
      type: "object",
      maxProperties: 64,
      additionalProperties: { type: "string", maxLength: 32768 },
    },
    workingDirectory: { type: "string", minLength: 1, maxLength: 4096 },
    initialInput: { oneOf: [textSchema, { type: "null" }] },
    /** Variables the session host must not pass on from its own environment. */
    environmentRemove: {
      type: "array",
      maxItems: 64,
      items: { type: "string", pattern: "^[A-Za-z_][A-Za-z0-9_]{0,127}$" },
    },
    /** Whether `transcript.read` can read this session's provider transcript. */
    transcript: { type: "boolean" },
  },
} as const;

const textContent = <Title extends string, Kind extends string>(title: Title, kind: Kind) =>
  ({
    title,
    type: "object",
    additionalProperties: false,
    required: ["kind", "text"],
    properties: { kind: { type: "string", enum: [kind] }, text: textSchema },
  }) as const;

export const decodedContentSchemas = [
  textContent("UserMessageContent", "user_message"),
  textContent("AgentMessageContent", "agent_message"),
  textContent("QuestionContent", "question"),
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

export const coreResultResponseSchema = {
  title: "CoreResultResponse",
  type: "object",
  additionalProperties: false,
  required: ["kind", "id", "result"],
  properties: {
    kind: { type: "string", enum: ["core.result"] },
    id: requestIdSchema,
    result: { type: "object", maxProperties: 32 },
    launch: coreLaunchSchema,
  },
} as const;

export const coreFailedResponseSchema = {
  title: "CoreFailedResponse",
  type: "object",
  additionalProperties: false,
  required: ["kind", "id", "code"],
  properties: {
    kind: { type: "string", enum: ["core.failed"] },
    id: requestIdSchema,
    code: codeSchema,
    stage: { type: "string", enum: ["workspace", "workstream", "launch"] },
  },
} as const;

export const decoderDecodedResponseSchema = {
  title: "DecoderDecodedResponse",
  type: "object",
  additionalProperties: false,
  required: ["kind", "id", "events"],
  properties: {
    kind: { type: "string", enum: ["decoder.decoded"] },
    id: requestIdSchema,
    events: { type: "array", maxItems: 4096, items: decodedEventSchema },
    /** For `decoder.send`: the Base64 bytes to write to the provider's standard input. */
    input: { type: "string", maxLength: 1398104 },
  },
} as const;

/** Answers `transcript.read`: complete items, oldest first, and whether the transcript ended. */
export const transcriptPageResponseSchema = {
  title: "TranscriptPageResponse",
  type: "object",
  additionalProperties: false,
  required: ["kind", "id", "items", "complete"],
  properties: {
    kind: { type: "string", enum: ["transcript.page"] },
    id: requestIdSchema,
    items: {
      type: "array",
      maxItems: 500,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["content", "createdAtMs"],
        properties: { content: decodedContentSchema, createdAtMs: epochMillisecondsSchema },
      },
    },
    complete: { type: "boolean" },
  },
} as const;

export const coreLinkResponseSchemas = [
  coreResultResponseSchema,
  coreFailedResponseSchema,
  decoderDecodedResponseSchema,
  transcriptPageResponseSchema,
] as const;

export const coreLinkResponseSchema = {
  title: "CoreLinkResponse",
  oneOf: coreLinkResponseSchemas,
} as const;

export type CoreLinkRequest = FromSchema<typeof coreLinkRequestSchema>;
export type CoreLinkResponse = FromSchema<typeof coreLinkResponseSchema>;
export type CoreLaunch = FromSchema<typeof coreLaunchSchema>;
export type DecodedEvent = FromSchema<typeof decodedEventSchema>;
export type DecodedContent = FromSchema<typeof decodedContentSchema>;
