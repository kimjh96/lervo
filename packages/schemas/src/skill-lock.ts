import type { FromSchema } from "json-schema-to-ts";

import {
  capabilityNameSchema,
  projectIdSchema,
  providerSchema,
  roleIdSchema,
  schemaVersionSchema,
  semverSchema,
  sha256Schema,
  skillIdSchema,
  timestampSchema,
} from "./common.js";

export const skillRejectionReasons = [
  "scope_disabled",
  "provider_incompatible",
  "role_incompatible",
  "runtime_incompatible",
  "platform_incompatible",
  "tool_unavailable",
  "capability_denied",
  "source_shadowed",
  "version_shadowed",
] as const;

const skillLockSourceKindSchema = {
  type: "string",
  enum: ["project", "user"],
} as const;

const skillLockIdentityProperties = {
  skillId: skillIdSchema,
  version: semverSchema,
  contentHash: sha256Schema,
} as const;

export const skillLockSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/skill-lock.schema.json",
  title: "Lervo resolved skill lock",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    projectId: projectIdSchema,
    generatedAt: timestampSchema,
    runtime: {
      type: "object",
      properties: {
        provider: providerSchema,
        roleId: roleIdSchema,
        runtimeVersion: semverSchema,
        platform: {
          type: "string",
          enum: ["darwin", "linux", "win32"],
        },
        availableTools: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 150 },
          uniqueItems: true,
        },
        allowedCapabilities: {
          type: "array",
          items: capabilityNameSchema,
          uniqueItems: true,
        },
      },
      required: [
        "provider",
        "roleId",
        "runtimeVersion",
        "platform",
        "availableTools",
        "allowedCapabilities",
      ],
      additionalProperties: false,
    },
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ...skillLockIdentityProperties,
          source: {
            type: "object",
            properties: {
              kind: skillLockSourceKindSchema,
              uri: { type: "string", minLength: 1, maxLength: 1000 },
            },
            required: ["kind", "uri"],
            additionalProperties: false,
          },
          trustStatus: {
            type: "string",
            enum: ["untrusted", "reviewed", "verified"],
          },
          pinned: { type: "boolean" },
        },
        required: ["skillId", "version", "contentHash", "source", "trustStatus", "pinned"],
        additionalProperties: false,
      },
    },
    rejected: {
      type: "array",
      items: {
        type: "object",
        properties: {
          ...skillLockIdentityProperties,
          sourceKind: skillLockSourceKindSchema,
          reasonCode: {
            type: "string",
            enum: skillRejectionReasons,
          },
        },
        required: ["skillId", "version", "contentHash", "sourceKind", "reasonCode"],
        additionalProperties: false,
      },
    },
  },
  required: ["schemaVersion", "projectId", "generatedAt", "runtime", "entries", "rejected"],
  additionalProperties: false,
} as const;

export type SkillLock = FromSchema<typeof skillLockSchema>;
export type SkillLockEntry = SkillLock["entries"][number];
export type SkillLockRejection = SkillLock["rejected"][number];
