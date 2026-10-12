import { validateSchema } from "@lervo/schemas";
import { parse, stringify } from "yaml";
import { LervoProjectError } from "./types.js";

export function formatValidationErrors(
  errors: ReadonlyArray<{ instancePath: string; message?: string }>,
): string {
  return errors
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

export function parseAndValidateYaml<T>(
  schema: "project" | "documentRegistry" | "documentManifest",
  content: string,
): T {
  let value: unknown;
  try {
    value = parse(content);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new LervoProjectError("invalid_yaml", `Unable to read YAML: ${detail}`, { cause: error });
  }
  const validation = validateSchema(schema, value);
  if (!validation.valid) {
    throw new LervoProjectError(
      "contract_invalid",
      `The value does not satisfy the contract: ${formatValidationErrors(validation.errors)}`,
    );
  }
  return value as T;
}

export function serializeYaml(value: unknown): string {
  return stringify(value, { lineWidth: 0 });
}
