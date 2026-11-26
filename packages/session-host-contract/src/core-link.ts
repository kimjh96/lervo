/**
 * The core link: messages between the session host and the resident Lervo application process,
 * which the session host runs as its child and reaches over the child's standard streams, one
 * JSON message per line. The session host asks; the core answers each request by its `id`.
 */
import type { FromSchema } from "json-schema-to-ts";

import { applicationCommandNames, providerIdSchema } from "./application-results.js";
import { codeSchema, epochMillisecondsSchema, identifierSchema } from "./primitives.js";
import { decodedContentSchema, decodedEventSchema } from "./core-link-decoded.js";
import { sentImagesSchema } from "./image.js";
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
  {
    decoderId: identifierSchema,
    provider: providerIdSchema,
    /**
     * The hosted session the decoder serves, so the core records its turns' usage. The session
     * host sends it only to a core that advertised `decoder.session`.
     */
    sessionId: identifierSchema,
    /**
     * Whether the session host performs the deliveries the decoder's answers carry (Lervo ADE
     * rooms). It sends it only to a core that advertised `decoder.deliveries`.
     */
    deliveries: { type: "boolean" },
  },
  ["decoderId", "provider"],
);

/** Asks the decoder for the bytes that stop the provider's running turn, as `input`. */
export const decoderInterruptRequestSchema = request(
  "DecoderInterruptRequest",
  "decoder.interrupt",
  { decoderId: identifierSchema },
  ["decoderId"],
);

/**
 * Asks the decoder for the bytes of the user's message, as `input`. `images` goes only to a core
 * that advertised `decoder.images`.
 */
export const decoderSendRequestSchema = request(
  "DecoderSendRequest",
  "decoder.send",
  {
    decoderId: identifierSchema,
    text: textSchema,
    images: sentImagesSchema,
    /** The delivery this text performs, so the core shows it as its sender's (Lervo ADE rooms). */
    deliveryId: identifierSchema,
  },
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

/**
 * The session host's report that a hosted session's process ended. It sends it only to a core
 * whose `workspace.list` advertises `session.exited`, so an older core never receives it. The
 * core records `terminal.session.ended` unless the provider's own `SessionEnd` hook already did.
 */
export const sessionExitedRequestSchema = request(
  "SessionExitedRequest",
  "session.exited",
  {
    sessionId: identifierSchema,
    /** The process exit code, or null after a signal. */
    exitCode: { oneOf: [{ type: "integer", minimum: 0, maximum: 255 }, { type: "null" }] },
  },
  ["sessionId", "exitCode"],
);

/**
 * Core-link requests and request fields beyond the base ones that a core advertises in
 * `workspace.list`'s `commands`, beside its application commands, so a session host sends them
 * only to a core that answers them. `decoder.session` names `decoder.open`'s `sessionId`,
 * `decoder.images` names `decoder.send`'s `images`, and `workspace.participants` names
 * `workspace.start`'s `participants`.
 */
export const advertisedCoreRequestNames = [
  "session.exited",
  "decoder.session",
  "decoder.interrupt",
  "decoder.images",
  "workspace.participants",
  "decoder.deliveries",
] as const;

export const coreLinkRequestSchemas = [
  coreCommandRequestSchema,
  coreOpenRequestSchema,
  transcriptReadRequestSchema,
  sessionExitedRequestSchema,
  decoderOpenRequestSchema,
  decoderSendRequestSchema,
  decoderInterruptRequestSchema,
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

/** A turn for an agent of the conversation, which joins first when `sessionId` is null. */
export const roomDeliverySchema = {
  title: "RoomDelivery",
  type: "object",
  additionalProperties: false,
  required: ["deliveryId", "workspaceId", "agentId", "sessionId", "text"],
  properties: {
    deliveryId: identifierSchema,
    workspaceId: identifierSchema,
    agentId: identifierSchema,
    sessionId: { oneOf: [identifierSchema, { type: "null" }] },
    text: { type: "string", minLength: 1, maxLength: 65536 },
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
    /**
     * Turns for the session host to give other agents of the conversation, only for a decoder
     * opened with `deliveries` (Lervo ADE rooms, "The core link and the session host").
     */
    deliveries: { type: "array", maxItems: 16, items: roomDeliverySchema },
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
