import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";

/**
 * ADR-0477 delegation-bound definitions a seeding host installed before it seeded a peer's scope.
 * Each entry names the definition kind, the hash the reviewed scope binds, the installed content
 * hash, and whether a file was created or a Lervo-managed file replaced. Suite IDs, role IDs,
 * paths, commands, and content stay out of the event.
 */
export const knowledgeConvergenceDefinitionsInstalledEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-convergence-definitions-installed-event-payload.schema.json",
  type: "object",
  properties: {
    repositoryIdentityHash: sha256Schema,
    scopeHash: sha256Schema,
    observerHostHash: { anyOf: [sha256Schema, { type: "null" }] },
    sourceHostHash: { anyOf: [sha256Schema, { type: "null" }] },
    definitions: {
      type: "array",
      minItems: 1,
      maxItems: 32,
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["verification_suite", "repository_role", "asset_disposition_manifest"],
          },
          bindingHash: sha256Schema,
          contentHash: sha256Schema,
          action: { type: "string", enum: ["created", "replaced"] },
        },
        required: ["kind", "bindingHash", "contentHash", "action"],
        additionalProperties: false,
      },
    },
    occurredAt: timestampSchema,
  },
  required: [
    "repositoryIdentityHash",
    "scopeHash",
    "observerHostHash",
    "sourceHostHash",
    "definitions",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export type KnowledgeConvergenceDefinitionsInstalledEventPayload = FromSchema<
  typeof knowledgeConvergenceDefinitionsInstalledEventPayloadSchema
>;
