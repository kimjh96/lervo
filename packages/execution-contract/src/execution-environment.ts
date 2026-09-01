import { createHash } from "node:crypto";

import type { ExecutionEnvironmentProfile } from "@lervo/schemas";
import { validateSchema } from "@lervo/schemas";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

export function assertExecutionEnvironmentProfile(profile: ExecutionEnvironmentProfile): void {
  const validation = validateSchema("executionEnvironmentProfile", profile);
  if (!validation.valid) {
    throw new TypeError(
      `Execution environment profile is invalid: ${validation.errors
        .map((item) => `${item.instancePath} ${item.message}`)
        .join("; ")}`,
    );
  }
}

export function executionEnvironmentProfileBytes(profile: ExecutionEnvironmentProfile): Uint8Array {
  assertExecutionEnvironmentProfile(profile);
  return new TextEncoder().encode(canonicalJson(profile));
}

export function executionEnvironmentProfileHash(profile: ExecutionEnvironmentProfile): string {
  return `sha256:${createHash("sha256")
    .update(executionEnvironmentProfileBytes(profile))
    .digest("hex")}`;
}
