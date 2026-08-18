import { createHash } from "node:crypto";

export function sha256(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item !== undefined) result[key] = canonicalValue(item);
    }
    return result;
  }
  return value;
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return Buffer.from(`${JSON.stringify(canonicalValue(value))}\n`, "utf8");
}

export function digestSuffix(value: string, length = 16): string {
  return sha256(value).slice("sha256:".length, "sha256:".length + length);
}
