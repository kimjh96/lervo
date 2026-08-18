import { randomUUID } from "node:crypto";

import type { AdapterSession } from "@roven/schemas";
import { validateSchema } from "@roven/schemas";

import { CodexAdapterError } from "./types.js";

export const CODEX_ADAPTER_ID = "roven/codex";
export const CODEX_ADAPTER_VERSION = "0.1.0";

export function defaultEventId(): string {
  return `evt_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function defaultReceiptId(): string {
  return `ctx_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function clone<T>(value: T): T {
  return structuredClone(value);
}

export function sameSession(left: AdapterSession, right: AdapterSession): boolean {
  return (
    left.adapterId === right.adapterId &&
    left.projectId === right.projectId &&
    left.runId === right.runId &&
    left.sessionId === right.sessionId &&
    left.roleId === right.roleId &&
    left.writingPolicyId === right.writingPolicyId &&
    left.provider === right.provider &&
    left.providerSessionId === right.providerSessionId &&
    left.startedAt === right.startedAt
  );
}

export function assertAdapterMessage(value: unknown, label: string): void {
  const result = validateSchema("adapter", value);
  if (!result.valid) {
    throw new CodexAdapterError("invalid_request", `${label}이 adapter schema를 통과하지 못했습니다.`);
  }
}

export function timestamp(now: () => Date, label: string, notBefore?: string): string {
  const value = now();
  const minimum = notBefore === undefined ? Number.NEGATIVE_INFINITY : Date.parse(notBefore);
  if (!Number.isFinite(value.getTime()) || !Number.isFinite(minimum) || value.getTime() < minimum) {
    throw new CodexAdapterError("invalid_request", `${label}이 유효하지 않습니다.`);
  }
  return value.toISOString();
}
