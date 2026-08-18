import type { FromSchema } from "json-schema-to-ts";

export const schemaVersionSchema = {
  type: "integer",
  const: 1,
} as const;

export const timestampSchema = {
  type: "string",
  format: "date-time",
} as const;

export const sha256Schema = {
  type: "string",
  pattern: "^sha256:[a-f0-9]{64}$",
} as const;

export const projectIdSchema = {
  type: "string",
  pattern: "^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const runIdSchema = {
  type: "string",
  pattern: "^run_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const sessionIdSchema = {
  type: "string",
  pattern: "^ses_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const documentIdSchema = {
  type: "string",
  pattern: "^doc_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const eventIdSchema = {
  type: "string",
  pattern: "^evt_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const receiptIdSchema = {
  type: "string",
  pattern: "^ctx_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const sharedContextIdSchema = {
  type: "string",
  pattern: "^scx_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const handoffIdSchema = {
  type: "string",
  pattern: "^hnd_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const writingPolicyIdSchema = {
  type: "string",
  pattern: "^writing_[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
  maxLength: 150,
} as const;

export const artifactIdSchema = {
  type: "string",
  pattern: "^art_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const writingEvaluationIdSchema = {
  type: "string",
  pattern: "^wre_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$",
} as const;

export const localeSchema = {
  type: "string",
  pattern: "^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?$",
} as const;

export const roleIdSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$",
  maxLength: 100,
} as const;

export const skillIdSchema = {
  type: "string",
  pattern: "^[a-z][a-z0-9]*(?:[._/-][a-z0-9]+)*$",
  maxLength: 150,
} as const;

export const semverSchema = {
  type: "string",
  pattern:
    "^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?$",
} as const;

export const repositoryRelativePathSchema = {
  type: "string",
  minLength: 1,
  pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?![A-Za-z]:[\\\\/]).+",
} as const;

export const schemaReferenceSchema = {
  type: "string",
  minLength: 1,
  maxLength: 500,
} as const;

export const capabilityNames = [
  "filesystem.read",
  "filesystem.write",
  "shell.execute",
  "network.access",
  "external.message",
  "deploy",
  "data.mutate",
] as const;

export const capabilityNameSchema = {
  type: "string",
  enum: capabilityNames,
} as const;

export const scopeSchema = {
  oneOf: [
    {
      type: "object",
      properties: {
        kind: { const: "full" },
      },
      required: ["kind"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        kind: { const: "sections" },
        sections: {
          type: "array",
          items: { type: "string", minLength: 1 },
          minItems: 1,
          uniqueItems: true,
        },
      },
      required: ["kind", "sections"],
      additionalProperties: false,
    },
  ],
} as const;

export const providerSchema = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  pattern: "^[a-z][a-z0-9_-]*$",
} as const;

export type ContextScope = FromSchema<typeof scopeSchema>;
