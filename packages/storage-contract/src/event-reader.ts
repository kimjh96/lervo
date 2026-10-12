import type { EventEnvelope } from "@lervo/schemas";

import type { EventStore } from "./index.js";

const maximumPageSize = 1_000;

export type EventReadFailureCode = "event_limit_exceeded" | "event_sequence_invalid";

export class EventReadError extends Error {
  constructor(
    readonly code: EventReadFailureCode,
    message: string,
  ) {
    super(message);
    this.name = "EventReadError";
  }
}

function assertPositiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a safe integer of at least 1.`);
  }
}

function assertForwardPage(
  page: readonly EventEnvelope[],
  afterSeq: number,
  expectedRunId?: string,
): void {
  let previousSeq = afterSeq;
  for (const event of page) {
    if (
      event.seq <= previousSeq ||
      (expectedRunId !== undefined && event.runId !== expectedRunId)
    ) {
      throw new EventReadError(
        "event_sequence_invalid",
        "The event store did not return a forward page matching the requested coordinates.",
      );
    }
    previousSeq = event.seq;
  }
}

interface ChainPosition {
  seq: number;
  eventHash: string | null;
}

/**
 * Project snapshots are read from the first event without filters, so each event must extend
 * the previous one. A complete traversal therefore verifies the whole chain it returns.
 */
function assertChainedPage(page: readonly EventEnvelope[], position: ChainPosition): ChainPosition {
  let current = position;
  for (const event of page) {
    if (event.seq !== current.seq + 1 || event.previousHash !== current.eventHash) {
      throw new EventReadError(
        "event_sequence_invalid",
        "The event store returned a project snapshot that does not extend its predecessor.",
      );
    }
    current = { seq: event.seq, eventHash: event.eventHash };
  }
  return current;
}

/**
 * Collects one run's immutable originals with an explicit memory bound.
 * The extra read after an exact-size final page distinguishes EOF from overflow.
 */
export function collectRunEventsBounded(input: {
  events: Pick<EventStore, "list">;
  runId: string;
  maximumEvents: number;
  pageSize?: number;
}): EventEnvelope[] {
  if (input.runId.length === 0) throw new TypeError("runId must not be empty.");
  assertPositiveSafeInteger(input.maximumEvents, "maximumEvents");
  const pageSize = input.pageSize ?? maximumPageSize;
  assertPositiveSafeInteger(pageSize, "pageSize");
  if (pageSize > maximumPageSize) throw new TypeError("pageSize must not exceed 1,000.");

  const events: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const remaining = input.maximumEvents - events.length;
    const page = input.events.list({
      runId: input.runId,
      afterSeq,
      limit: Math.min(pageSize, remaining + 1),
    });
    assertForwardPage(page, afterSeq, input.runId);
    if (page.length > remaining) {
      throw new EventReadError(
        "event_limit_exceeded",
        `Run events exceed the allowed limit of ${input.maximumEvents}.`,
      );
    }
    events.push(...page);
    if (page.length < Math.min(pageSize, remaining + 1)) return events;
    afterSeq = page.at(-1)!.seq;
  }
}

/**
 * Collects the project's events of the given types in sequence order with an explicit memory
 * bound. Rows are verified as they are decoded; the gaps between them are not traversed.
 */
export function collectEventsOfTypesBounded(input: {
  events: Pick<EventStore, "list">;
  types: readonly string[];
  maximumEvents: number;
  pageSize?: number;
}): EventEnvelope[] {
  assertPositiveSafeInteger(input.maximumEvents, "maximumEvents");
  const pageSize = input.pageSize ?? maximumPageSize;
  assertPositiveSafeInteger(pageSize, "pageSize");
  if (pageSize > maximumPageSize) throw new TypeError("pageSize must not exceed 1,000.");
  const types = new Set(input.types);

  const events: EventEnvelope[] = [];
  let afterSeq = 0;
  while (true) {
    const remaining = input.maximumEvents - events.length;
    const page = input.events.list({
      afterSeq,
      limit: Math.min(pageSize, remaining + 1),
      types: input.types,
    });
    assertForwardPage(page, afterSeq);
    if (page.some((event) => !types.has(event.type)))
      throw new EventReadError(
        "event_sequence_invalid",
        "The event store returned an event outside the requested types.",
      );
    if (page.length > remaining) {
      throw new EventReadError(
        "event_limit_exceeded",
        `Events of the requested types exceed the allowed limit of ${input.maximumEvents}.`,
      );
    }
    events.push(...page);
    if (page.length < Math.min(pageSize, remaining + 1)) return events;
    afterSeq = page.at(-1)!.seq;
  }
}

/** Collects one immutable project event snapshot with an explicit memory bound. */
export function collectProjectEventsBounded(input: {
  events: Pick<EventStore, "list">;
  maximumEvents: number;
  pageSize?: number;
}): EventEnvelope[] {
  assertPositiveSafeInteger(input.maximumEvents, "maximumEvents");
  const pageSize = input.pageSize ?? maximumPageSize;
  assertPositiveSafeInteger(pageSize, "pageSize");
  if (pageSize > maximumPageSize) throw new TypeError("pageSize must not exceed 1,000.");

  const events: EventEnvelope[] = [];
  let afterSeq = 0;
  let position: ChainPosition = { seq: 0, eventHash: null };
  while (true) {
    const remaining = input.maximumEvents - events.length;
    const page = input.events.list({
      afterSeq,
      limit: Math.min(pageSize, remaining + 1),
    });
    position = assertChainedPage(page, position);
    if (page.length > remaining) {
      throw new EventReadError(
        "event_limit_exceeded",
        `Project events exceed the allowed limit of ${input.maximumEvents}.`,
      );
    }
    events.push(...page);
    if (page.length < Math.min(pageSize, remaining + 1)) return events;
    afterSeq = page.at(-1)!.seq;
  }
}

/**
 * Visits a project event snapshot without retaining the full project history.
 * Events appended after throughSeq are never observed by this scan. Visiting through the
 * head verifies every predecessor link up to that head.
 */
export function visitEventSnapshot(input: {
  events: Pick<EventStore, "list">;
  throughSeq: number;
  /** When supplied, the visited head must be exactly this observed event. */
  throughHash?: string;
  visit(event: EventEnvelope): void;
  pageSize?: number;
}): void {
  if (!Number.isSafeInteger(input.throughSeq) || input.throughSeq < 0) {
    throw new TypeError("throughSeq must be a safe integer of at least 0.");
  }
  const pageSize = input.pageSize ?? maximumPageSize;
  assertPositiveSafeInteger(pageSize, "pageSize");
  if (pageSize > maximumPageSize) throw new TypeError("pageSize must not exceed 1,000.");

  let afterSeq = 0;
  let position: ChainPosition = { seq: 0, eventHash: null };
  while (afterSeq < input.throughSeq) {
    const page = input.events.list({ afterSeq, limit: pageSize });
    const snapshotPage = page.filter((event) => event.seq <= input.throughSeq);
    position = assertChainedPage(snapshotPage, position);
    const next = snapshotPage.at(-1)?.seq;
    if (next === undefined) {
      throw new EventReadError(
        "event_sequence_invalid",
        "The event snapshot could not be read through the requested sequence.",
      );
    }
    snapshotPage.forEach(input.visit);
    afterSeq = next;
  }
  if (input.throughHash !== undefined && position.eventHash !== input.throughHash) {
    throw new EventReadError(
      "event_sequence_invalid",
      "The event snapshot does not end at the observed head.",
    );
  }
}
