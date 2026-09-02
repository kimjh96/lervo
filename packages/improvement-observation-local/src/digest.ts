import { createHash } from "node:crypto";

export function stableObservationJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableObservationJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableObservationJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function observationDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableObservationJson(value)).digest("hex")}`;
}
