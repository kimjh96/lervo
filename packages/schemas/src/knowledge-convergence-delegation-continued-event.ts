import type { FromSchema } from "json-schema-to-ts";

import { sha256Schema, timestampSchema } from "./common.js";

/**
 * ADR-0469 delegation continuity. A resident records each delegation it renewed or seeded under
 * the owner's continuity policy, and (ADR-0470) each identity-preserving rebind after a managed
 * upgrade changed a bound suite or role contract (`rebound`, source `binding_refresh`). Under
 * ADR-0478 a host that does not own the repository records the owner's term it adopted (`adopted`,
 * source `owner`, with the owner as `sourceHostHash`). The event carries hashes and the new expiry
 * only; agent identities, roots, Hub coordinates, and labels stay in host-local state.
 */
export const knowledgeConvergenceDelegationContinuedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/knowledge-convergence-delegation-continued-event-payload.schema.json",
  type: "object",
  properties: {
    repositoryIdentityHash: sha256Schema,
    action: { type: "string", enum: ["renewed", "seeded", "rebound", "adopted"] },
    source: {
      type: "string",
      enum: ["renewal", "peer", "policy_template", "binding_refresh", "owner"],
    },
    policyHash: sha256Schema,
    previousPlanHash: { anyOf: [sha256Schema, { type: "null" }] },
    planHash: sha256Schema,
    scopeHash: sha256Schema,
    expiresAt: timestampSchema,
    observerHostHash: { anyOf: [sha256Schema, { type: "null" }] },
    sourceHostHash: { anyOf: [sha256Schema, { type: "null" }] },
    occurredAt: timestampSchema,
  },
  required: [
    "repositoryIdentityHash",
    "action",
    "source",
    "policyHash",
    "previousPlanHash",
    "planHash",
    "scopeHash",
    "expiresAt",
    "observerHostHash",
    "sourceHostHash",
    "occurredAt",
  ],
  additionalProperties: false,
} as const;

export type KnowledgeConvergenceDelegationContinuedEventPayload = FromSchema<
  typeof knowledgeConvergenceDelegationContinuedEventPayloadSchema
>;
