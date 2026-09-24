import type { FromSchema } from "json-schema-to-ts";

import {
  eventIdSchema,
  projectIdSchema,
  repositoryRelativePathSchema,
  runIdSchema,
  schemaVersionSchema,
  sessionIdSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";

export const adapterNormalizedEventTypes = [
  "provider.session.started",
  "provider.session.restarted",
  "provider.session.stopped",
  "provider.context.compacted",
  "provider.turn.started",
  "provider.turn.completed",
  "provider.turn.failed",
  "provider.tool.called",
  "provider.command.executed",
  "provider.file_change.reported",
  "provider.usage.updated",
  "provider.usage.estimated",
  "provider.error",
] as const;

const providerEventPayloadRules = [
  {
    if: { properties: { type: { const: "provider.session.started" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: { adapterVersion: { type: "string", minLength: 1 } },
          required: ["adapterVersion"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.session.restarted" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            reason: { type: "string", enum: ["process_restarted", "session_resumed"] },
          },
          required: ["reason"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.session.stopped" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["completed", "failed", "cancelled", "unknown"] },
          },
          required: ["status"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.context.compacted" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerTurnId: { type: "string", minLength: 1 },
            providerItemId: { type: "string", minLength: 1 },
          },
          required: ["providerTurnId", "providerItemId"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.turn.started" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: { providerTurnId: { type: "string", minLength: 1 } },
          required: ["providerTurnId"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.turn.completed" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerTurnId: { type: "string", minLength: 1 },
            status: { type: "string", enum: ["completed", "interrupted"] },
            durationMs: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
          },
          required: ["providerTurnId", "status", "durationMs"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.turn.failed" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerTurnId: { type: "string", minLength: 1 },
            failureCode: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
            diagnosticDigest: sha256Schema,
          },
          required: ["providerTurnId", "failureCode", "diagnosticDigest"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.tool.called" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerItemId: { type: "string", minLength: 1 },
            toolName: { type: "string", minLength: 1 },
            inputDigest: sha256Schema,
            status: { type: "string", enum: ["in_progress", "completed", "failed", "declined"] },
            durationMs: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
          },
          required: ["providerItemId", "toolName", "inputDigest", "status", "durationMs"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.command.executed" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerItemId: { type: "string", minLength: 1 },
            commandDigest: sha256Schema,
            cwdRelative: {
              anyOf: [repositoryRelativePathSchema, { const: "." }, { type: "null" }],
            },
            status: { type: "string", enum: ["in_progress", "completed", "failed", "declined"] },
            exitCode: { anyOf: [{ type: "integer" }, { type: "null" }] },
            outputDigest: { anyOf: [sha256Schema, { type: "null" }] },
            durationMs: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
          },
          required: [
            "providerItemId",
            "commandDigest",
            "cwdRelative",
            "status",
            "exitCode",
            "outputDigest",
            "durationMs",
          ],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.file_change.reported" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerItemId: { type: "string", minLength: 1 },
            paths: { type: "array", items: repositoryRelativePathSchema, minItems: 1 },
            changeKinds: {
              type: "array",
              items: { type: "string", enum: ["created", "modified", "deleted", "moved"] },
              minItems: 1,
            },
            status: { type: "string", enum: ["in_progress", "completed", "failed", "declined"] },
            diffDigest: sha256Schema,
          },
          required: ["providerItemId", "paths", "changeKinds", "status", "diffDigest"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    // An in-flight lower bound for budget enforcement only; accounting uses provider.usage.updated.
    if: { properties: { type: { const: "provider.usage.estimated" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerTurnId: { type: "string", minLength: 1 },
            totalTokens: { type: "integer", minimum: 0 },
          },
          required: ["providerTurnId", "totalTokens"],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.usage.updated" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            providerTurnId: { type: "string", minLength: 1 },
            inputTokens: { type: "integer", minimum: 0 },
            cachedInputTokens: { type: "integer", minimum: 0 },
            outputTokens: { type: "integer", minimum: 0 },
            reasoningOutputTokens: { type: "integer", minimum: 0 },
            totalTokens: { type: "integer", minimum: 0 },
            contextWindow: { anyOf: [{ type: "integer", minimum: 0 }, { type: "null" }] },
          },
          required: [
            "providerTurnId",
            "inputTokens",
            "cachedInputTokens",
            "outputTokens",
            "reasoningOutputTokens",
            "totalTokens",
            "contextWindow",
          ],
          additionalProperties: false,
        },
      },
    },
  },
  {
    if: { properties: { type: { const: "provider.error" } }, required: ["type"] },
    then: {
      properties: {
        payload: {
          type: "object",
          properties: {
            failureCode: { type: "string", pattern: "^[a-z][a-z0-9_]{0,63}$" },
            diagnosticDigest: sha256Schema,
            retryable: { type: "boolean" },
          },
          required: ["failureCode", "diagnosticDigest", "retryable"],
          additionalProperties: false,
        },
      },
    },
  },
] as const;

export const adapterNormalizedEventSchema = {
  type: "object",
  properties: {
    kind: { const: "normalized_event" },
    schemaVersion: schemaVersionSchema,
    eventId: eventIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    providerSessionId: { type: "string", minLength: 1 },
    type: { type: "string", enum: adapterNormalizedEventTypes },
    occurredAt: timestampSchema,
    payload: { type: "object" },
  },
  required: [
    "kind",
    "schemaVersion",
    "eventId",
    "projectId",
    "runId",
    "sessionId",
    "providerSessionId",
    "type",
    "occurredAt",
    "payload",
  ],
  allOf: providerEventPayloadRules,
  additionalProperties: false,
} as const;

export type AdapterNormalizedEvent = FromSchema<typeof adapterNormalizedEventSchema>;
export type AdapterNormalizedEventType = (typeof adapterNormalizedEventTypes)[number];
