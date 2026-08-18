import { createHash } from "node:crypto";
import { isAbsolute, normalize, relative, sep } from "node:path";

export type Json = boolean | number | string | null | Json[] | { [key: string]: Json };

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function integer(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}

export function nonNegativeInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function jsonValue(value: unknown): Json {
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(jsonValue);
  if (!isRecord(value)) return null;
  const output: Record<string, Json> = Object.create(null) as Record<string, Json>;
  for (const key of Object.keys(value).sort()) output[key] = jsonValue(value[key]);
  return output;
}

export function digest(value: unknown): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(jsonValue(value))).digest("hex")}`;
}

export function eventTime(
  message: Record<string, unknown>,
  params: Record<string, unknown>,
  now: () => Date,
): string {
  const milliseconds =
    integer(message.emittedAtMs) ?? integer(params.completedAtMs) ?? integer(params.startedAtMs);
  if (milliseconds !== null && milliseconds >= 0) return new Date(milliseconds).toISOString();
  return now().toISOString();
}

export function providerThreadId(
  method: string,
  params: Record<string, unknown>,
): string | undefined {
  const direct = text(params.threadId);
  if (direct !== undefined) return direct;
  if (method === "thread/started") return text(asRecord(params.thread)?.id);
  return undefined;
}

export function lifecycleStatus(
  value: unknown,
): "in_progress" | "completed" | "failed" | "declined" | null {
  if (value === "completed" || value === "failed" || value === "declined") return value;
  if (value === "inProgress") return "in_progress";
  return null;
}

export function repositoryPath(root: string, value: unknown): string | null {
  const source = text(value);
  if (source === undefined || source.includes("\0")) return null;
  const candidate = isAbsolute(source) ? relative(root, source) : normalize(source);
  const portable = candidate.split(sep).join("/");
  if (portable.length === 0 || portable === "." || portable === ".." || portable.startsWith("../")) {
    return null;
  }
  return portable;
}

export function cwdRelative(root: string, value: unknown): string | null {
  const source = text(value);
  if (source === undefined) return null;
  const candidate = isAbsolute(source) ? relative(root, source) : normalize(source);
  const portable = candidate.split(sep).join("/");
  if (portable === "" || portable === ".") return ".";
  if (portable === ".." || portable.startsWith("../")) return null;
  return portable;
}

export function fileKind(value: unknown): "created" | "modified" | "deleted" | "moved" {
  const kind = asRecord(value);
  if (kind?.type === "add") return "created";
  if (kind?.type === "delete") return "deleted";
  if (kind?.type === "update" && text(kind.move_path) !== undefined) return "moved";
  return "modified";
}
