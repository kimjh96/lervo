import type { FromSchema } from "json-schema-to-ts";

import {
  localeSchema,
  repositoryRelativePathSchema,
  roleIdSchema,
  schemaReferenceSchema,
  schemaVersionSchema,
  skillIdSchema,
  writingPolicyIdSchema,
} from "./common.js";

export const capabilityDecisions = ["allow", "deny", "require_approval"] as const;

const capabilityDecisionSchema = {
  type: "string",
  enum: capabilityDecisions,
} as const;

export const roleProfileSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/role-profile.schema.json",
  title: "Lervo role profile",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    roleId: roleIdSchema,
    name: { type: "string", minLength: 1, maxLength: 100 },
    description: { type: "string", minLength: 1, maxLength: 1000 },
    requestTypes: {
      type: "array",
      items: { type: "string", minLength: 1, maxLength: 100 },
      minItems: 1,
      uniqueItems: true,
    },
    requiredInputs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: {
            type: "string",
            pattern: "^[a-z][A-Za-z0-9]*$",
            maxLength: 100,
          },
          schemaRef: schemaReferenceSchema,
          required: { type: "boolean" },
          sensitive: { type: "boolean" },
        },
        required: ["name", "schemaRef", "required", "sensitive"],
        additionalProperties: false,
      },
      uniqueItems: true,
    },
    contextPolicy: {
      type: "object",
      properties: {
        requiredDocumentRuleIds: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 150 },
          minItems: 1,
          uniqueItems: true,
        },
        minimumAssurance: { const: "E3" },
        referencesRequired: { type: "boolean" },
      },
      required: ["requiredDocumentRuleIds", "minimumAssurance", "referencesRequired"],
      additionalProperties: false,
    },
    capabilities: {
      type: "object",
      properties: {
        "filesystem.read": capabilityDecisionSchema,
        "filesystem.write": capabilityDecisionSchema,
        "shell.execute": capabilityDecisionSchema,
        "network.access": capabilityDecisionSchema,
        "external.message": capabilityDecisionSchema,
        deploy: capabilityDecisionSchema,
        "data.mutate": capabilityDecisionSchema,
      },
      required: [
        "filesystem.read",
        "filesystem.write",
        "shell.execute",
        "network.access",
        "external.message",
        "deploy",
        "data.mutate"
      ],
      additionalProperties: false,
    },
    defaultSkills: {
      type: "array",
      items: skillIdSchema,
      uniqueItems: true,
    },
    outputContract: {
      type: "object",
      properties: {
        artifactKind: { type: "string", minLength: 1, maxLength: 100 },
        schemaRef: schemaReferenceSchema,
        pathTemplate: {
          ...repositoryRelativePathSchema,
          maxLength: 500,
        },
        citationsRequired: { type: "boolean" },
        presentation: {
          oneOf: [
            {
              type: "object",
              properties: {
                audience: { const: "machine" },
                writingPolicyId: { type: "null" },
              },
              required: ["audience", "writingPolicyId"],
              additionalProperties: false,
            },
            {
              type: "object",
              properties: {
                audience: {
                  type: "string",
                  enum: ["human", "mixed"],
                },
                locale: localeSchema,
                writingPolicyId: writingPolicyIdSchema,
              },
              required: ["audience", "locale", "writingPolicyId"],
              additionalProperties: false,
            },
          ],
        },
      },
      required: [
        "artifactKind",
        "schemaRef",
        "pathTemplate",
        "citationsRequired",
        "presentation"
      ],
      additionalProperties: false,
    },
    verification: {
      type: "object",
      properties: {
        suiteIds: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 150 },
          minItems: 1,
          uniqueItems: true,
        },
        failureDisposition: {
          type: "string",
          enum: ["fail_run", "require_review"],
        },
      },
      required: ["suiteIds", "failureDisposition"],
      additionalProperties: false,
    },
    handoff: {
      type: "object",
      properties: {
        allowedRoleIds: {
          type: "array",
          items: roleIdSchema,
          uniqueItems: true,
        },
        evidenceLinksRequired: { const: true },
        sharedContextRequired: { const: true },
      },
      required: ["allowedRoleIds", "evidenceLinksRequired", "sharedContextRequired"],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "roleId",
    "name",
    "description",
    "requestTypes",
    "requiredInputs",
    "contextPolicy",
    "capabilities",
    "defaultSkills",
    "outputContract",
    "verification",
    "handoff"
  ],
  additionalProperties: false,
} as const;

export type RoleProfile = FromSchema<typeof roleProfileSchema>;
export type CapabilityDecision = (typeof capabilityDecisions)[number];
