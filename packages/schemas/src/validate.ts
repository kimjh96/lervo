import type { ErrorObject } from "ajv";
import validators from "#compiled-validators";
import type { SchemaName } from "./schema-catalog.js";

export type { SchemaName } from "./schema-catalog.js";

export type ValidationResult =
  { valid: true; errors: [] } | { valid: false; errors: ErrorObject[] };

export function validateSchema(name: SchemaName, value: unknown): ValidationResult {
  const validator = validators[name];
  if (validator(value)) return { valid: true, errors: [] };
  return { valid: false, errors: validator.errors ? [...validator.errors] : [] };
}
