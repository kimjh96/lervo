import type { FromSchema } from "json-schema-to-ts";

import { sentImagesSchema } from "./image.js";
import { identifierSchema, sequenceSchema } from "./primitives.js";
import { choiceAnswersSchema } from "./choices.js";

export const conversationModeSchema = { enum: ["native", "cli"] } as const;

/** Starts the agent session of an existing workspace. The session host asks the core how. */
export const sessionOpenMessageSchema = {
  title: "SessionOpenMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "workspaceId"],
  properties: {
    kind: { type: "string", enum: ["session.open"] },
    requestId: identifierSchema,
    workspaceId: identifierSchema,
    /** Reopens the session in this mode; a running session in another mode stops first. */
    conversationMode: conversationModeSchema,
  },
} as const;

export const sessionAttachMessageSchema = {
  title: "SessionAttachMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId", "afterSequence"],
  properties: {
    kind: { type: "string", enum: ["session.attach"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
    afterSequence: { type: "integer", minimum: 0 },
  },
} as const;

export const sessionDetachMessageSchema = {
  title: "SessionDetachMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "sessionId"],
  properties: {
    kind: { type: "string", enum: ["session.detach"] },
    sessionId: identifierSchema,
  },
} as const;

/**
 * Subscribes the connection to the status of every session, without output. The session host
 * answers with each live session's status and then sends each change.
 */
export const sessionsWatchMessageSchema = {
  title: "SessionsWatchMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind"],
  properties: {
    kind: { type: "string", enum: ["sessions.watch"] },
  },
} as const;

/**
 * The user's message for the native conversation: text, images, or both. Text may be empty only
 * when the message carries images; a message with neither is answered `message_empty`. The
 * interface sends images only to a session host as current as itself and a core that advertises
 * `decoder.images`; otherwise the session host answers `images_unsupported`.
 */
export const sessionSendMessageSchema = {
  title: "SessionSendMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId", "text"],
  properties: {
    kind: { type: "string", enum: ["session.send"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
    text: { type: "string", maxLength: 262144 },
    images: sentImagesSchema,
  },
} as const;

/**
 * Stops the native conversation's running turn and keeps the session: the provider ends the turn
 * where it is and waits for the next message. A session host from before it does not know it, so
 * the interface sends it only to a session host that offers it (see `sessionHostOffersInterrupt`).
 */
export const sessionInterruptMessageSchema = {
  title: "SessionInterruptMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId"],
  properties: {
    kind: { type: "string", enum: ["session.interrupt"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
  },
} as const;

/**
 * Answers the agent's question with choices: `answers` by each question's text. The session host
 * sends it only to a session whose decoder answers questions; it answers with `session.sent`.
 */
export const sessionAnswerMessageSchema = {
  title: "SessionAnswerMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId", "questionId", "answers"],
  properties: {
    kind: { type: "string", enum: ["session.answer"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
    /** The question's `choices.requestId`. */
    questionId: identifierSchema,
    answers: choiceAnswersSchema,
  },
} as const;

export const sessionResizeMessageSchema = {
  title: "SessionResizeMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "sessionId", "columns", "rows"],
  properties: {
    kind: { type: "string", enum: ["session.resize"] },
    sessionId: identifierSchema,
    columns: { type: "integer", minimum: 1, maximum: 1000 },
    rows: { type: "integer", minimum: 1, maximum: 1000 },
  },
} as const;

export const sessionStopMessageSchema = {
  title: "SessionStopMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId"],
  properties: {
    kind: { type: "string", enum: ["session.stop"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
  },
} as const;

export const sessionOpenedMessageSchema = {
  title: "SessionOpenedMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId", "workspaceId", "conversationMode", "channel"],
  properties: {
    kind: { type: "string", enum: ["session.opened"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
    workspaceId: identifierSchema,
    conversationMode: conversationModeSchema,
    channel: { type: "integer", minimum: 1, maximum: 4294967295 },
  },
} as const;

export const sessionStatusMessageSchema = {
  title: "SessionStatusMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "sessionId", "sequence", "status"],
  properties: {
    kind: { type: "string", enum: ["session.status"] },
    sessionId: identifierSchema,
    sequence: sequenceSchema,
    status: { enum: ["starting", "working", "needs_user", "idle", "ended"] },
    endReason: { enum: ["completed", "stopped", "failed", "provider_exited"] },
  },
} as const;

/** The provider received the text of a `session.send`; failures answer with `request.failed`. */
export const sessionSentMessageSchema = {
  title: "SessionSentMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId"],
  properties: {
    kind: { type: "string", enum: ["session.sent"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
  },
} as const;

/**
 * The provider received a `session.interrupt`. The turn's own end follows as status; failures
 * answer with `request.failed`, such as `interrupt_unsupported` for a provider or core that cannot.
 */
export const sessionInterruptedMessageSchema = {
  title: "SessionInterruptedMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "requestId", "sessionId"],
  properties: {
    kind: { type: "string", enum: ["session.interrupted"] },
    requestId: identifierSchema,
    sessionId: identifierSchema,
  },
} as const;

export const sessionResyncRequiredMessageSchema = {
  title: "SessionResyncRequiredMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "sessionId"],
  properties: {
    kind: { type: "string", enum: ["session.resync_required"] },
    sessionId: identifierSchema,
  },
} as const;

export type ConversationMode = FromSchema<typeof conversationModeSchema>;
export type SessionOpenMessage = FromSchema<typeof sessionOpenMessageSchema>;
export type SessionAttachMessage = FromSchema<typeof sessionAttachMessageSchema>;
export type SessionDetachMessage = FromSchema<typeof sessionDetachMessageSchema>;
export type SessionSendMessage = FromSchema<typeof sessionSendMessageSchema>;
export type SessionInterruptMessage = FromSchema<typeof sessionInterruptMessageSchema>;
export type SessionAnswerMessage = FromSchema<typeof sessionAnswerMessageSchema>;
export type SessionInterruptedMessage = FromSchema<typeof sessionInterruptedMessageSchema>;
export type SessionResizeMessage = FromSchema<typeof sessionResizeMessageSchema>;
export type SessionStopMessage = FromSchema<typeof sessionStopMessageSchema>;
export type SessionOpenedMessage = FromSchema<typeof sessionOpenedMessageSchema>;
export type SessionStatusMessage = FromSchema<typeof sessionStatusMessageSchema>;
export type SessionResyncRequiredMessage = FromSchema<typeof sessionResyncRequiredMessageSchema>;
export type SessionSentMessage = FromSchema<typeof sessionSentMessageSchema>;
export type SessionsWatchMessage = FromSchema<typeof sessionsWatchMessageSchema>;
