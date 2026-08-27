import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function canonicalHash(value: unknown): string {
  return `sha256:${createHash("sha256").update(canonicalJson(value)).digest("hex")}`;
}

export function contentId(prefix: string, value: unknown): string {
  return `${prefix}_${canonicalHash(value).slice("sha256:".length)}`;
}

export function isCanonicalOrder(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]!.localeCompare(value) < 0);
}

export function timestamp(value: string): number {
  return Date.parse(value);
}
