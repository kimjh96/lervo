import { createHash } from "node:crypto";

import { canonicalJson } from "@lervo/event-contract";
import { eventTypes, type EventType } from "@lervo/schemas";

export interface TraceCursorPayload {
  schemaVersion: 1;
  projectId: string;
  runId: string;
  eventCount: number;
  headHash: string;
  afterSeq: number;
  afterEventHash: string;
  limit: number;
  eventTypes?: EventType[];
}

const idPattern = /^(?:prj|run)_[A-Za-z0-9][A-Za-z0-9_-]{7,63}$/;
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const cursorPattern = /^trc_([A-Za-z0-9_-]+)\.([a-f0-9]{64})$/;
const eventTypeSet = new Set<string>(eventTypes);
export const maximumTraceCursorBytes = 2048;

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
    (payload.eventTypes === undefined || (
      Array.isArray(payload.eventTypes) &&
      payload.eventTypes.length >= 1 &&
      new Set(payload.eventTypes).size === payload.eventTypes.length &&
      payload.eventTypes.every((eventType) => eventTypeSet.has(eventType)) &&
      payload.eventTypes.every((eventType, index) =>
        index === 0 || payload.eventTypes![index - 1]! < eventType)
    )) &&
    Object.keys(payload).length === (payload.eventTypes === undefined ? 8 : 9);
}

export function createTraceCursor(payload: TraceCursorPayload): string {
  const encoded = Buffer.from(canonicalJson(payload), "utf8").toString("base64url");
  return `trc_${encoded}.${digest(encoded)}`;
}

export function decodeTraceCursor(cursor: string): TraceCursorPayload | null {
  if (Buffer.byteLength(cursor, "utf8") > maximumTraceCursorBytes) return null;
  const match = cursorPattern.exec(cursor);
  if (match === null || digest(match[1]!) !== match[2]) return null;
  try {
    const value = JSON.parse(Buffer.from(match[1]!, "base64url").toString("utf8"));
    return isTraceCursorPayload(value) ? value : null;
  } catch {
    return null;
  }
}
