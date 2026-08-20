import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";

export interface TraceCursorPayload {
  schemaVersion: 1;
  projectId: string;
  runId: string;
  eventCount: number;
  headHash: string;
  afterSeq: number;
  afterEventHash: string;
  limit: number;
}

const idPattern = /^(?:prj|run)_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const cursorPattern = /^trc_([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/;

function digest(encoded: string): string {
  return createHash("sha256").update(encoded).digest("hex");
}

function isTraceCursorPayload(value: unknown): value is TraceCursorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const payload = value as Partial<TraceCursorPayload>;
  return payload.schemaVersion === 1 &&
    typeof payload.projectId === "string" && idPattern.test(payload.projectId) &&
    typeof payload.runId === "string" && idPattern.test(payload.runId) &&
    Number.isSafeInteger(payload.eventCount) && payload.eventCount! >= 1 &&
    typeof payload.headHash === "string" && hashPattern.test(payload.headHash) &&
    Number.isSafeInteger(payload.afterSeq) && payload.afterSeq! >= 1 &&
    typeof payload.afterEventHash === "string" && hashPattern.test(payload.afterEventHash) &&
    Number.isSafeInteger(payload.limit) && payload.limit! >= 1 && payload.limit! <= 100 &&
    Object.keys(payload).length === 8;
}

export function createTraceCursor(payload: TraceCursorPayload): string {
  const encoded = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  return `trc_${encoded}.${digest(encoded)}`;
}

export function decodeTraceCursor(cursor: string): TraceCursorPayload | null {
  if (cursor.length > 2048) return null;
  const match = cursorPattern.exec(cursor);
  if (match === null || digest(match[1]!) !== match[2]) return null;
  try {
    const value = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8"));
    return isTraceCursorPayload(value) ? value : null;
  } catch {
    return null;
  }
}
