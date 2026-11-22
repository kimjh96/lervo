import type { FromSchema } from "json-schema-to-ts";

import { identifierSchema } from "./primitives.js";

/** The protocol version this contract defines. */
export const SESSION_HOST_PROTOCOL_VERSION = 1;

const softwareSchema = {
  type: "object",
  additionalProperties: false,
  required: ["name", "version"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 64 },
    version: { type: "string", minLength: 1, maxLength: 32 },
  },
} as const;

export const helloMessageSchema = {
  title: "HelloMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "protocolVersions", "client", "token"],
  properties: {
    kind: { type: "string", enum: ["hello"] },
    protocolVersions: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      uniqueItems: true,
      items: { type: "integer", minimum: 1 },
    },
    client: softwareSchema,
    token: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
} as const;

export const welcomeMessageSchema = {
  title: "WelcomeMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "protocolVersion", "host"],
  properties: {
    kind: { type: "string", enum: ["welcome"] },
    protocolVersion: { type: "integer", const: SESSION_HOST_PROTOCOL_VERSION },
    host: {
      type: "object",
      additionalProperties: false,
      required: ["hostId", "name", "version"],
      properties: {
        hostId: identifierSchema,
        name: { type: "string", minLength: 1, maxLength: 64 },
        version: { type: "string", minLength: 1, maxLength: 32 },
      },
    },
  },
} as const;

export const rejectedMessageSchema = {
  title: "RejectedMessage",
  type: "object",
  additionalProperties: false,
  required: ["kind", "code"],
  properties: {
    kind: { type: "string", enum: ["rejected"] },
    code: { enum: ["protocol_unsupported", "token_invalid"] },
  },
} as const;

export type HelloMessage = FromSchema<typeof helloMessageSchema>;
export type WelcomeMessage = FromSchema<typeof welcomeMessageSchema>;
export type RejectedMessage = FromSchema<typeof rejectedMessageSchema>;
