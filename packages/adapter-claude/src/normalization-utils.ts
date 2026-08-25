import { createHash } from "node:crypto";
import { isAbsolute, normalize, relative, sep } from "node:path";

export type Json = boolean | number | string | null | Json[] | { [key: string]: Json };

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function integer(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}

function jsonValue(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonValue);
  const source = asRecord(value);
  if (source === undefined) return null;
  const output: Record<string, Json> = Object.create(null) as Record<string, Json>;
  for (const key of Object.keys(source).sort()) output[key] = jsonValue(source[key]);
  return output;
}

export function digest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(jsonValue(value)))
    .digest("hex")}`;
}

export function eventTime(message: Record<string, unknown>, now: () => Date): string {
  const source = text(message.timestamp) ?? text(message.processed_at);
  if (source !== undefined && Number.isFinite(Date.parse(source)))
    return new Date(source).toISOString();
  return now().toISOString();
}

export function cwdRelative(root: string, value: unknown): string | null {
  const source = value === undefined ? root : text(value);
  if (source === undefined || source.includes("\0")) return null;
  const candidate = isAbsolute(source) ? relative(root, source) : normalize(source);
  const portable = candidate.split(sep).join("/");
  if (portable === "" || portable === ".") return ".";
  if (portable === ".." || portable.startsWith("../")) return null;
  return portable;
}

export function repositoryPath(root: string, value: unknown): string | null {
  const path = cwdRelative(root, value);
  return path === "." ? null : path;
}

export function toolResultBlocks(message: Record<string, unknown>): Record<string, unknown>[] {
  const content = asRecord(message.message)?.content;
  if (!Array.isArray(content)) return [];
  return content
    .map(asRecord)
    .filter((block): block is Record<string, unknown> => block?.type === "tool_result");
}
