import type { FromSchema } from "json-schema-to-ts";

import { providerSchema, roleIdSchema, sha256Schema, timestampSchema } from "./common.js";

export const roleProfileActivatedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/role-profile-activated-event-payload.schema.json",
  type: "object",
  properties: {
    activationId: { type: "string", pattern: "^rpact_[a-f0-9]{24}$" },
    provider: providerSchema,
    roleId: roleIdSchema,
    roleVersion: {
      type: "string",
      pattern: "^(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)\\.(?:0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$",
      maxLength: 100,
    },
    roleContractHash: sha256Schema,
    roleProfileHash: sha256Schema,
    runtimeProfileHash: sha256Schema,
    sourceKind: { type: "string", enum: ["built_in", "repository"] },
    activatedAt: timestampSchema,
  },
  required: [
    "activationId",
    "provider",
    "roleId",
    "roleVersion",
    "roleContractHash",
    "roleProfileHash",
    "runtimeProfileHash",
    "sourceKind",
    "activatedAt",
  ],
  additionalProperties: false,
} as const;

export type RoleProfileActivatedEventPayload = FromSchema<
  typeof roleProfileActivatedEventPayloadSchema
>;
