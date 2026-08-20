import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function contentId(prefix: string, value: unknown): string {
  return `${prefix}_${createHash("sha256").update(canonicalJson(value)).digest("hex").slice(0, 24)}`;
}

export function canonicalHash(value: unknown): string {
  return sha256(canonicalJson(value));
}
