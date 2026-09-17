import type { FromSchema } from "json-schema-to-ts";

import {
  deliberationPolicyIdSchema,
  projectIdSchema,
  providerSchema,
  roleIdSchema,
  schemaVersionSchema,
  sha256Schema,
  verificationSuiteIdSchema,
  writingPolicyIdSchema,
} from "./common.js";
import { writingSurfaces } from "./writing.js";

export const deliberationResponsibilities = [
  "proposer",
  "reviewer",
  "verifier",
  "decision_owner",
] as const;

const providerSelectionSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        mode: { const: "fixed" },
        provider: providerSchema,
      },
      required: ["mode", "provider"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        mode: { const: "allowlist" },
        providers: {
          type: "array",
          items: providerSchema,
          minItems: 1,
          maxItems: 8,
          uniqueItems: true,
        },
      },
      required: ["mode", "providers"],
      additionalProperties: false,
    },
  ],
} as const;

export const deliberationExecutionBudgetSchema = {
  type: "object",
  properties: {
    maximumProviderCalls: { type: "integer", minimum: 1, maximum: 64 },
    maximumObservedTokens: { type: "integer", minimum: 1, maximum: 10_000_000 },
    maximumElapsedMs: { type: "integer", minimum: 1_000, maximum: 3_600_000 },
    unobservedTokenDisposition: { const: "block" },
  },
  required: [
    "maximumProviderCalls",
    "maximumObservedTokens",
    "maximumElapsedMs",
    "unobservedTokenDisposition",
  ],
  additionalProperties: false,
} as const;

export const deliberationPolicySchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/deliberation-policy.schema.json",
  title: "Lervo provider-neutral deliberation policy",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    policyId: deliberationPolicyIdSchema,
    projectId: projectIdSchema,
    participants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          roleId: roleIdSchema,
          responsibilities: {
            type: "array",
            items: { type: "string", enum: deliberationResponsibilities },
            minItems: 1,
            uniqueItems: true,
          },
          providerSelection: providerSelectionSchema,
        },
        required: ["roleId", "responsibilities", "providerSelection"],
        additionalProperties: false,
      },
      minItems: 2,
      maxItems: 16,
    },
    decisionOwnerRoleId: roleIdSchema,
    maxRounds: { type: "integer", minimum: 1, maximum: 20 },
    executionBudget: deliberationExecutionBudgetSchema,
    requiredVerificationSuiteIds: {
      type: "array",
      items: verificationSuiteIdSchema,
      minItems: 1,
      maxItems: 32,
      uniqueItems: true,
    },
    convergence: {
      type: "object",
      properties: {
        requireIndependentReviewer: { const: true },
        requireIndependentSessions: { const: true },
        requireDecisionOwnerDecision: { const: true },
        requirePassedVerifications: { const: true },
        requireZeroUnresolvedBlockingObjections: { const: true },
        unresolvedBlockingDisposition: { const: "no_consensus" },
      },
      required: [
        "requireIndependentReviewer",
        "requireIndependentSessions",
        "requireDecisionOwnerDecision",
        "requirePassedVerifications",
        "requireZeroUnresolvedBlockingObjections",
        "unresolvedBlockingDisposition",
      ],
      additionalProperties: false,
    },
    publication: {
      type: "object",
      properties: {
        surface: { type: "string", enum: writingSurfaces },
        writingPolicyId: writingPolicyIdSchema,
        writingPolicyHash: sha256Schema,
        requiresWritingPermit: { const: true },
      },
      required: ["surface", "writingPolicyId", "writingPolicyHash", "requiresWritingPermit"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "policyId",
    "projectId",
    "participants",
    "decisionOwnerRoleId",
    "maxRounds",
    "requiredVerificationSuiteIds",
    "convergence",
    "publication",
  ],
  additionalProperties: false,
} as const;

export type DeliberationPolicy = FromSchema<typeof deliberationPolicySchema>;
export type DeliberationResponsibility = (typeof deliberationResponsibilities)[number];
