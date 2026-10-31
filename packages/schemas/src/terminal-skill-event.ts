import type { FromSchema } from "json-schema-to-ts";
import { repositoryRelativePathSchema, sha256Schema, timestampSchema } from "./common.js";

const coordinates = {
  providerSessionDigest: sha256Schema,
  providerTurnDigest: { ...sha256Schema, type: ["string", "null"] },
  observedAt: timestampSchema,
} as const;

export const terminalSkillObservedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-skill-observed-event-payload.schema.json",
  type: "object",
  properties: {
    ...coordinates,
    skillId: { type: "string", pattern: "^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$" },
    path: repositoryRelativePathSchema,
    contentHash: sha256Schema,
    provider: { type: "string", enum: ["codex", "claude"] },
    source: { type: "string", enum: ["provider_transcript", "prompt_invocation"] },
  },
  required: [
    "skillId",
    "path",
    "contentHash",
    "provider",
    "source",
    "providerSessionDigest",
    "providerTurnDigest",
    "observedAt",
  ],
  additionalProperties: false,
} as const;

export const terminalSkillTurnAssessedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/terminal-skill-turn-assessed-event-payload.schema.json",
  type: "object",
  properties: {
    ...coordinates,
    skillTelemetry: { type: "string", enum: ["observed", "unavailable", "truncated"] },
    externalSkillCount: { type: "integer", minimum: 0 },
  },
  required: [
    "providerSessionDigest",
    "providerTurnDigest",
    "skillTelemetry",
    "externalSkillCount",
    "observedAt",
  ],
  additionalProperties: false,
} as const;

export type TerminalSkillObservedEventPayload = FromSchema<
  typeof terminalSkillObservedEventPayloadSchema
>;
export type TerminalSkillTurnAssessedEventPayload = FromSchema<
  typeof terminalSkillTurnAssessedEventPayloadSchema
>;
