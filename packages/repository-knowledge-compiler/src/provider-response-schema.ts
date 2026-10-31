import { compileFailure } from "./compiler-failure.js";
export function providerResponseContractSchema(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw compileFailure("The provider JSON runner input has no response contract.");
  }
  const responseContract = (input as Record<string, unknown>).responseContract;
  if (
    typeof responseContract !== "object" ||
    responseContract === null ||
    Array.isArray(responseContract)
  ) {
    throw compileFailure("The provider JSON runner input has no response contract.");
  }
  const schema = (responseContract as Record<string, unknown>).schema;
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) {
    throw compileFailure("The provider JSON runner response schema is invalid.");
  }
  return schema;
}

function nativeJsonSchemaType(value: unknown): string | undefined {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
    case "boolean":
      return typeof value;
    case "number":
      return Number.isInteger(value) ? "integer" : "number";
    case "object":
      return "object";
    default:
      return undefined;
  }
}

export function providerNativeResponseSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => providerNativeResponseSchema(item));
  if (typeof value !== "object" || value === null) return value;
  const source = value as Record<string, unknown>;
  const result = Object.fromEntries(
    Object.entries(source)
      .filter(
        ([key]) =>
          !["uniqueItems", "minItems", "maxItems", "minLength", "maxLength", "pattern"].includes(
            key,
          ),
      )
      .map(([key, item]) => [key === "oneOf" ? "anyOf" : key, providerNativeResponseSchema(item)]),
  );
  if (result.type === undefined && Object.hasOwn(source, "const")) {
    const inferred = nativeJsonSchemaType(source.const);
    if (inferred !== undefined) result.type = inferred;
  }
  return result;
}
