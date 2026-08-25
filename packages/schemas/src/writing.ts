import type { FromSchema } from "json-schema-to-ts";

import { localeSchema, schemaVersionSchema, writingPolicyIdSchema } from "./common.js";

export const deterministicWritingCheckIds = [
  "forbid_em_dash",
  "forbid_abstract_action_subject",
  "no_empty_sections",
  "forbid_vague_terms",
] as const;

export const writingInformationItems = [
  "purpose_or_conclusion",
  "reason",
  "change_or_result",
  "scope_and_impact",
  "next_action",
  "evidence",
  "technical_details",
] as const;

export const writingSurfaces = [
  "readme",
  "pull_request",
  "issue",
  "review_comment",
  "status",
  "chat",
  "documentation",
  "commit",
  "code_comment",
] as const;

const writingFollowupInformationItems = [
  "reason",
  "change_or_result",
  "scope_and_impact",
  "next_action",
  "evidence",
  "technical_details",
] as const;

export const writingContractSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://schemas.lervo.dev/v0/writing-contract.schema.json",
  title: "Lervo human-readable writing policy",
  type: "object",
  properties: {
    schemaVersion: schemaVersionSchema,
    writingPolicyId: writingPolicyIdSchema,
    locale: localeSchema,
    surfaces: {
      type: "array",
      items: {
        type: "string",
        enum: writingSurfaces,
      },
      minItems: 1,
      uniqueItems: true,
    },
    audience: {
      type: "string",
      enum: ["technical", "nontechnical", "mixed", "public"],
    },
    informationOrder: {
      type: "object",
      properties: {
        lead: { const: "purpose_or_conclusion" },
        then: {
          type: "array",
          items: { type: "string", enum: writingFollowupInformationItems },
          uniqueItems: true,
        },
      },
      required: ["lead", "then"],
      additionalProperties: false,
    },
    prose: {
      type: "object",
      properties: {
        register: {
          type: "string",
          enum: ["polite", "plain_spec", "repository_convention"],
        },
        completeSentences: { const: true },
        cohesiveParagraphs: { const: true },
        oneMainFactPerSentence: { const: true },
        avoidTranslationeseAndFragments: { const: true },
      },
      required: [
        "register",
        "completeSentences",
        "cohesiveParagraphs",
        "oneMainFactPerSentence",
        "avoidTranslationeseAndFragments",
      ],
      additionalProperties: false,
    },
    terminology: {
      type: "object",
      properties: {
        preserveMachineIdentifiers: { const: true },
        explainInternalTermsAtFirstUse: { const: true },
        preferConcreteVerbs: { const: true },
        forbiddenVagueTerms: {
          type: "array",
          items: { type: "string", minLength: 1, maxLength: 100 },
          uniqueItems: true,
        },
      },
      required: [
        "preserveMachineIdentifiers",
        "explainInternalTermsAtFirstUse",
        "preferConcreteVerbs",
        "forbiddenVagueTerms",
      ],
      additionalProperties: false,
    },
    actions: {
      type: "object",
      properties: {
        abstractActors: { const: "forbid" },
        stateObjectAndActionDirectly: { const: true },
        stateWhenNoActionIsNeeded: { const: true },
      },
      required: ["abstractActors", "stateObjectAndActionDirectly", "stateWhenNoActionIsNeeded"],
      additionalProperties: false,
    },
    evidence: {
      type: "object",
      properties: {
        majorClaimsRequireEvidence: { const: true },
        distinguishRunFromNotRun: { const: true },
        keepRawLogsOutOfPrimaryProse: { const: true },
      },
      required: [
        "majorClaimsRequireEvidence",
        "distinguishRunFromNotRun",
        "keepRawLogsOutOfPrimaryProse",
      ],
      additionalProperties: false,
    },
    verification: {
      type: "object",
      properties: {
        deterministicChecks: {
          type: "array",
          items: {
            type: "string",
            enum: deterministicWritingCheckIds,
          },
          minItems: 1,
          uniqueItems: true,
        },
        semanticChecks: {
          type: "array",
          items: {
            type: "object",
            properties: {
              checkId: {
                type: "string",
                pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
                maxLength: 150,
              },
              requirement: { type: "string", minLength: 1, maxLength: 1000 },
              required: { const: true },
            },
            required: ["checkId", "requirement", "required"],
            additionalProperties: false,
          },
          minItems: 1,
          uniqueItems: true,
        },
        semanticEvaluationMode: { const: "separate_pass" },
        requiresPassedEvaluation: { const: true },
        failureDisposition: { const: "block_publication" },
      },
      required: [
        "deterministicChecks",
        "semanticChecks",
        "semanticEvaluationMode",
        "requiresPassedEvaluation",
        "failureDisposition",
      ],
      additionalProperties: false,
    },
  },
  required: [
    "schemaVersion",
    "writingPolicyId",
    "locale",
    "surfaces",
    "audience",
    "informationOrder",
    "prose",
    "terminology",
    "actions",
    "evidence",
    "verification",
  ],
  additionalProperties: false,
} as const;

export type WritingContract = FromSchema<typeof writingContractSchema>;
export type DeterministicWritingCheckId = (typeof deterministicWritingCheckIds)[number];
export type WritingSurface = (typeof writingSurfaces)[number];
