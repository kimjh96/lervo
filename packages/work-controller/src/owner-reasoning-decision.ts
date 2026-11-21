import type { OwnerReasoningDecisionV1 } from "@lervo/application-contract";
import { providerOutputSchema } from "@lervo/schemas";

/** Every operation an owner decision may name. */
export const OWNER_REASONING_OPERATIONS = [
  "allocate_existing",
  "prepare_completion",
  "prepare_publication",
  "review_artifacts",
  "complete_workstream",
  "request_rework",
  "retry_attempt",
  "revise_responsibility",
  "request_team_support",
  "accept_team_support",
  "hire_worker",
  "escalate",
] as const;

/**
 * The owner decision schema offering only `operations`. ADR-0604: written as one literal through
 * `providerOutputSchema`, so no spread hides a name from the provider schema guard.
 */
export function ownerReasoningDecisionSchemaFor(operations: readonly string[]) {
  return providerOutputSchema({
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "operation", "rationale", "details"],
    properties: {
      schemaVersion: { type: "integer", const: 1 },
      operation: { type: "string", enum: [...operations] },
      rationale: { type: "string", minLength: 1, maxLength: 4096 },
      details: { type: "string", minLength: 2, maxLength: 32768 },
    },
  } as const);
}

export const ownerReasoningDecisionSchema = ownerReasoningDecisionSchemaFor(
  OWNER_REASONING_OPERATIONS,
);

export function parseOwnerReasoningDecision(text: string): OwnerReasoningDecisionV1 {
  if (Buffer.byteLength(text) > 65536)
    throw new Error("The owner decision exceeds its byte bound.");
  const value = JSON.parse(text) as OwnerReasoningDecisionV1;
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== 4 ||
    value.schemaVersion !== 1 ||
    !(OWNER_REASONING_OPERATIONS as readonly string[]).includes(value.operation) ||
    typeof value.rationale !== "string" ||
    value.rationale.trim().length === 0 ||
    value.rationale.length > 4096 ||
    typeof value.details !== "string" ||
    value.details.length < 2 ||
    value.details.length > 32768
  )
    throw new Error("The owner decision does not satisfy its proposal contract.");
  const details: unknown = JSON.parse(value.details);
  if (details === null || typeof details !== "object" || Array.isArray(details))
    throw new Error("Owner decision details must be a JSON object.");
  return value;
}
