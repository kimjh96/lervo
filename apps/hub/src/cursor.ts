import {
  type HubEventTraceCursor,
  type HubProjectTraceCursor,
  type HubRunTraceCursor,
} from "@lervo/hub-trace";

import {
  HUB_DESTINATION_ID_PATTERN,
  HUB_PROJECT_ID_PATTERN,
  HUB_RUN_ID_PATTERN,
} from "./identifiers.js";

const MAX_CURSOR_LENGTH = 1_024;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

type CursorKind = "project" | "run" | "event";

function encode(payload: Record<string, string | number>): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decode(value: string, kind: CursorKind): Record<string, unknown> {
  if (
    value.length === 0 || value.length > MAX_CURSOR_LENGTH ||
    !BASE64URL_PATTERN.test(value)
  ) {
    throw new Error("cursor 형식이 유효하지 않습니다.");
  }
  let text: string;
  try {
    text = Buffer.from(value, "base64url").toString("utf8");
  } catch {
    throw new Error("cursor 형식이 유효하지 않습니다.");
  }
  if (Buffer.from(text, "utf8").toString("base64url") !== value) {
    throw new Error("cursor 형식이 유효하지 않습니다.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("cursor 형식이 유효하지 않습니다.");
  }
  if (
    typeof parsed !== "object" || parsed === null || Array.isArray(parsed) ||
    (parsed as Record<string, unknown>).v !== 1 ||
    (parsed as Record<string, unknown>).kind !== kind
  ) {
    throw new Error("cursor 형식이 유효하지 않습니다.");
  }
  return parsed as Record<string, unknown>;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 1;
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 && value.length <= 256;
}

export function encodeProjectCursor(cursor: HubProjectTraceCursor): string {
  return encode({
    v: 1,
    kind: "project",
    destinationId: cursor.destinationId,
    projectId: cursor.projectId,
  });
}

export function decodeProjectCursor(value: string): HubProjectTraceCursor {
  const cursor = decode(value, "project");
  if (
    !hasExactKeys(cursor, ["v", "kind", "destinationId", "projectId"]) ||
    !nonEmptyText(cursor.destinationId) || !HUB_DESTINATION_ID_PATTERN.test(cursor.destinationId) ||
    !nonEmptyText(cursor.projectId) || !HUB_PROJECT_ID_PATTERN.test(cursor.projectId)
  ) {
    throw new Error("project cursor 형식이 유효하지 않습니다.");
  }
  return { destinationId: cursor.destinationId, projectId: cursor.projectId };
}

export function encodeRunCursor(cursor: HubRunTraceCursor): string {
  return encode({ v: 1, kind: "run", firstSeq: cursor.firstSeq, runId: cursor.runId });
}

export function decodeRunCursor(value: string): HubRunTraceCursor {
  const cursor = decode(value, "run");
  if (
    !hasExactKeys(cursor, ["v", "kind", "firstSeq", "runId"]) ||
    !positiveInteger(cursor.firstSeq) || !nonEmptyText(cursor.runId) ||
    !HUB_RUN_ID_PATTERN.test(cursor.runId)
  ) {
    throw new Error("run cursor 형식이 유효하지 않습니다.");
  }
  return { firstSeq: cursor.firstSeq, runId: cursor.runId };
}

export function encodeEventCursor(cursor: HubEventTraceCursor): string {
  return encode({ v: 1, kind: "event", seq: cursor.seq });
}

export function decodeEventCursor(value: string): HubEventTraceCursor {
  const cursor = decode(value, "event");
  if (!hasExactKeys(cursor, ["v", "kind", "seq"]) || !positiveInteger(cursor.seq)) {
    throw new Error("event cursor 형식이 유효하지 않습니다.");
  }
  return { seq: cursor.seq };
}
