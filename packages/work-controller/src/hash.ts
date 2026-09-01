import { createHash } from "node:crypto";

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function shortId(prefix: string, value: unknown): string {
  return `${prefix}_${sha256(JSON.stringify(value)).slice("sha256:".length, 24)}`;
}
