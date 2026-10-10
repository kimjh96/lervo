import type { ValidateFunction } from "ajv";
import type { SchemaName } from "./schema-catalog.js";

declare const validators: Record<SchemaName, ValidateFunction>;
export default validators;
