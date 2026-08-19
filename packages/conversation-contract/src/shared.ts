import { createHash } from "node:crypto";

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function digest(value: string): string {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export function sortedUnique(values: readonly string[]): boolean {
  return values.every((value, index) => index === 0 || values[index - 1]! < value);
}
