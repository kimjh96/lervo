import type { FromSchema } from "json-schema-to-ts";

import {
  projectIdSchema,
  runIdSchema,
  sessionIdSchema,
  sha256Schema,
  timestampSchema,
} from "./common.js";
import { adapterIdSchema } from "./adapter-primitives.js";

export const adapterProcessObservationStatusSchema = {
  type: "string",
  enum: ["running", "exited", "unobservable"],
} as const;

export const adapterProcessObservationEvidenceSchema = {
  type: "string",
  enum: ["owned_process_state", "transport_state_unavailable", "no_managed_process"],
} as const;

const processObservationProperties = {
  status: adapterProcessObservationStatusSchema,
  evidence: adapterProcessObservationEvidenceSchema,
  observedAt: timestampSchema,
} as const;

const processObservationDiscriminator = {
  oneOf: [
    {
      properties: {
        status: { enum: ["running", "exited"] },
        evidence: { const: "owned_process_state" },
      },
      required: ["status", "evidence"],
    },
    {
      properties: {
        status: { const: "unobservable" },
        evidence: { enum: ["transport_state_unavailable", "no_managed_process"] },
      },
      required: ["status", "evidence"],
    },
  ],
} as const;

export const adapterProcessObservationSchema = {
  type: "object",
  properties: {
    kind: { const: "process_observation" },
    schemaVersion: { const: 1 },
    adapterId: adapterIdSchema,
    projectId: projectIdSchema,
    runId: runIdSchema,
    sessionId: sessionIdSchema,
    providerSessionId: { type: "string", minLength: 1 },
    ...processObservationProperties,
  },
  required: [
    "kind",
    "schemaVersion",
    "adapterId",
    "projectId",
    "runId",
    "sessionId",
    "providerSessionId",
    "status",
    "evidence",
    "observedAt",
  ],
  allOf: [processObservationDiscriminator],
  additionalProperties: false,
} as const;

export const providerProcessObservedEventPayloadSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/provider-process-observed-event-payload.schema.json",
  type: "object",
  properties: {
    adapterId: adapterIdSchema,
    providerSessionDigest: sha256Schema,
    phase: { type: "string", enum: ["session_started", "turn_terminal", "before_stop"] },
    ...processObservationProperties,
    releasesAgentAuthority: { const: false },
    releasesAssignmentAuthority: { const: false },
    provesWorkProgress: { const: false },
  },
  required: [
    "adapterId",
    "providerSessionDigest",
    "phase",
    "status",
    "evidence",
    "observedAt",
    "releasesAgentAuthority",
    "releasesAssignmentAuthority",
    "provesWorkProgress",
  ],
  allOf: [processObservationDiscriminator],
  additionalProperties: false,
} as const;

export type AdapterProcessObservation = FromSchema<typeof adapterProcessObservationSchema>;
export type AdapterProcessObservationStatus = FromSchema<
  typeof adapterProcessObservationStatusSchema
>;
export type AdapterProcessObservationEvidence = FromSchema<
  typeof adapterProcessObservationEvidenceSchema
>;
export type ProviderProcessObservedEventPayload = FromSchema<
  typeof providerProcessObservedEventPayloadSchema
>;
