import type { FromSchema } from "json-schema-to-ts";

import {
  applicationCommandMessageSchema,
  applicationResultMessageSchema,
  noticeMessageSchema,
  requestFailedMessageSchema,
} from "./application.js";
import {
  conversationAppendedMessageSchema,
  conversationDeltaMessageSchema,
  conversationPageMessageSchema,
  conversationRangeMessageSchema,
} from "./conversation.js";
import { helloMessageSchema, rejectedMessageSchema, welcomeMessageSchema } from "./handshake.js";
import {
  sessionAttachMessageSchema,
  sessionDetachMessageSchema,
  sessionOpenMessageSchema,
  sessionOpenedMessageSchema,
  sessionResizeMessageSchema,
  sessionResyncRequiredMessageSchema,
  sessionSendMessageSchema,
  sessionSentMessageSchema,
  sessionStatusMessageSchema,
  sessionStopMessageSchema,
  sessionsWatchMessageSchema,
} from "./session.js";

/** Messages the interface sends to the session host. */
export const clientMessageSchemas = [
  helloMessageSchema,
  applicationCommandMessageSchema,
  sessionOpenMessageSchema,
  sessionAttachMessageSchema,
  sessionDetachMessageSchema,
  sessionsWatchMessageSchema,
  sessionSendMessageSchema,
  sessionResizeMessageSchema,
  sessionStopMessageSchema,
  conversationRangeMessageSchema,
] as const;

/** Messages the session host sends to the interface. */
export const hostMessageSchemas = [
  welcomeMessageSchema,
  rejectedMessageSchema,
  applicationResultMessageSchema,
  requestFailedMessageSchema,
  noticeMessageSchema,
  sessionOpenedMessageSchema,
  sessionStatusMessageSchema,
  sessionSentMessageSchema,
  sessionResyncRequiredMessageSchema,
  conversationAppendedMessageSchema,
  conversationDeltaMessageSchema,
  conversationPageMessageSchema,
] as const;

export const clientMessageSchema = { title: "ClientMessage", oneOf: clientMessageSchemas } as const;
export const hostMessageSchema = { title: "HostMessage", oneOf: hostMessageSchemas } as const;

export type ClientMessage = FromSchema<typeof clientMessageSchema>;
export type HostMessage = FromSchema<typeof hostMessageSchema>;
