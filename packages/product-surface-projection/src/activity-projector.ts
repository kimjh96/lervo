import { computeEventHash, eventWithoutHash } from "@lervo/event-contract";
import { type EventEnvelope, type ProductActivityPageV1, validateSchema } from "@lervo/schemas";

import {
  activityCursorFromEventHash,
  projectActivityItem,
} from "./activity-event-classification.js";

const sha256Pattern = /^sha256:[a-f0-9]{64}$/;
const cursorPattern = /^pac_[a-f0-9]{24}$/;

export interface ActivityEventWindowV1 {
  sourceEventHeadHash: string;
  repositoryRevision: string;
  requestCursor: string | null;
  precedingEventHash: string | null;
  precedingSequence: number;
  events: readonly unknown[];
  limit: number;
}

function failedPage(
  input: ActivityEventWindowV1,
  failureCode:
    "activity_evidence_invalid" | "activity_cursor_stale" | "activity_schema_unsupported",
): ProductActivityPageV1 {
  const fallbackCursor = activityCursorFromEventHash(input.sourceEventHeadHash);
  return {
    schemaVersion: 1,
    kind: "product_surface.activity",
    sourceEventHeadHash: input.sourceEventHeadHash,
    repositoryRevision: input.repositoryRevision,
    requestCursor: cursorPattern.test(input.requestCursor ?? "") ? input.requestCursor : null,
    returnedCursor: cursorPattern.test(input.requestCursor ?? "")
      ? (input.requestCursor as string)
      : fallbackCursor,
    nextCursor: null,
    limit: input.limit,
    status: "failed",
    failureCode,
    items: [],
  };
}

function hasSupportedSchemaVersion(value: unknown): boolean {
  if (!value || typeof value !== "object") return true;
  const schemaVersion = (value as { schemaVersion?: unknown }).schemaVersion;
  return (
    schemaVersion === undefined || schemaVersion === 1 || schemaVersion === 2 || schemaVersion === 3
  );
}

function validateCoordinates(input: ActivityEventWindowV1): void {
  if (
    !sha256Pattern.test(input.sourceEventHeadHash) ||
    !sha256Pattern.test(input.repositoryRevision)
  ) {
    throw new TypeError("Activity projection source hashes must be canonical SHA-256 coordinates.");
  }
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100) {
    throw new RangeError("Activity projection limit must be a safe integer between 1 and 100.");
  }
  if (input.requestCursor !== null && !cursorPattern.test(input.requestCursor)) {
    throw new TypeError("Activity projection cursor is invalid.");
  }
  if (input.precedingEventHash !== null && !sha256Pattern.test(input.precedingEventHash)) {
    throw new TypeError("Activity projection preceding event hash is invalid.");
  }
  if (!Number.isSafeInteger(input.precedingSequence) || input.precedingSequence < 0) {
    throw new RangeError("Activity projection preceding sequence must be a non-negative integer.");
  }
  if ((input.precedingEventHash === null) !== (input.precedingSequence === 0)) {
    throw new TypeError(
      "Activity projection preceding hash and sequence must identify one anchor.",
    );
  }
  if (input.events.length > input.limit + 1) {
    throw new RangeError("Activity projection windows may contain at most limit plus one event.");
  }
}

function validateWindowChain(
  events: readonly EventEnvelope[],
  precedingEventHash: string | null,
  precedingSequence: number,
  sourceEventHeadHash: string,
  hasMore: boolean,
): boolean {
  let previousHash = precedingEventHash;
  let previousSequence = precedingSequence;
  for (const event of events) {
    if (event.previousHash !== previousHash) return false;
    if (event.seq !== previousSequence + 1) return false;
    if (event.eventHash !== computeEventHash(eventWithoutHash(event))) return false;
    previousHash = event.eventHash;
    previousSequence = event.seq;
  }
  if (!hasMore && previousHash !== sourceEventHeadHash) return false;
  return true;
}

export function projectActivityPage(input: ActivityEventWindowV1): ProductActivityPageV1 {
  validateCoordinates(input);

  const expectedCursor =
    input.precedingEventHash === null
      ? null
      : activityCursorFromEventHash(input.precedingEventHash);
  if (input.requestCursor !== expectedCursor) {
    return failedPage(input, "activity_cursor_stale");
  }
  if (input.events.some((event) => !hasSupportedSchemaVersion(event))) {
    return failedPage(input, "activity_schema_unsupported");
  }

  const events: EventEnvelope[] = [];
  for (const candidate of input.events) {
    const result = validateSchema("event", candidate);
    if (!result.valid) return failedPage(input, "activity_evidence_invalid");
    events.push(candidate as EventEnvelope);
  }

  const hasMore = events.length > input.limit;
  if (
    !validateWindowChain(
      events,
      input.precedingEventHash,
      input.precedingSequence,
      input.sourceEventHeadHash,
      hasMore,
    )
  ) {
    return failedPage(input, "activity_evidence_invalid");
  }

  const pageEvents = events.slice(0, input.limit);
  const lastReturned = pageEvents.at(-1);
  const returnedCursor = lastReturned
    ? activityCursorFromEventHash(lastReturned.eventHash)
    : (input.requestCursor ?? activityCursorFromEventHash(input.sourceEventHeadHash));
  return {
    schemaVersion: 1,
    kind: "product_surface.activity",
    sourceEventHeadHash: input.sourceEventHeadHash,
    repositoryRevision: input.repositoryRevision,
    requestCursor: input.requestCursor,
    returnedCursor,
    nextCursor: hasMore ? returnedCursor : null,
    limit: input.limit,
    status: pageEvents.length === 0 ? "empty" : "complete",
    failureCode: null,
    items: pageEvents.map(projectActivityItem),
  };
}
