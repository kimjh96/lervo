import { NodeRuntimeError } from "./errors.js";

export function configRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new NodeRuntimeError("invalid_config", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function exactConfigKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
  label: string,
): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new NodeRuntimeError("invalid_config", `${label} contains unknown fields.`);
  }
}

export function configText(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 4_096 ||
    value.includes("\0")
  ) {
    throw new NodeRuntimeError("invalid_config", `${label} is invalid.`);
  }
  return value;
}

export function optionalConfigInteger(
  source: Record<string, unknown>,
  key: string,
  minimum: number,
  maximum: number,
  label: string,
): number | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new NodeRuntimeError("invalid_config", `${label}.${key} is invalid.`);
  }
  return value as number;
}
