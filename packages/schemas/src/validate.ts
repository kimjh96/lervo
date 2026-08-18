import { Ajv2020, type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";

import { adapterContractMessageSchema } from "./adapter.js";
import { contextEvidenceSchema } from "./context-evidence.js";
import { documentRegistrySchema } from "./document-registry.js";
import { eventEnvelopeSchema } from "./event.js";
import { projectManifestSchema } from "./project.js";
import { roleProfileSchema } from "./role.js";
import { handoffBundleSchema, sharedContextPublicationSchema } from "./shared-context.js";
import { skillManifestSchema } from "./skill.js";
import { skillLockSchema } from "./skill-lock.js";
import { writingContractSchema, writingEvaluationSchema } from "./writing.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
ajv.addFormat("date-time", {
  type: "string",
  validate: (value: string) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
});

const validators = {
  project: ajv.compile(projectManifestSchema),
  event: ajv.compile(eventEnvelopeSchema),
  contextEvidence: ajv.compile(contextEvidenceSchema),
  adapter: ajv.compile(adapterContractMessageSchema),
  role: ajv.compile(roleProfileSchema),
  sharedContext: ajv.compile(sharedContextPublicationSchema),
  handoffBundle: ajv.compile(handoffBundleSchema),
  skill: ajv.compile(skillManifestSchema),
  skillLock: ajv.compile(skillLockSchema),
  documentRegistry: ajv.compile(documentRegistrySchema),
  writingContract: ajv.compile(writingContractSchema),
  writingEvaluation: ajv.compile(writingEvaluationSchema),
} satisfies Record<string, ValidateFunction>;

export type SchemaName = keyof typeof validators;

export type ValidationResult =
  | { valid: true; errors: [] }
  | { valid: false; errors: ErrorObject[] };

export function validateSchema(name: SchemaName, value: unknown): ValidationResult {
  const validator = validators[name];
  if (validator(value)) {
    return { valid: true, errors: [] };
  }

  return {
    valid: false,
    errors: validator.errors ? [...validator.errors] : [],
  };
}
