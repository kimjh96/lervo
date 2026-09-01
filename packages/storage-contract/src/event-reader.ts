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
  while (true) {
    const remaining = input.maximumEvents - events.length;
    const page = input.events.list({
      afterSeq,
      limit: Math.min(pageSize, remaining + 1),
    });
    assertForwardPage(page, afterSeq);
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
 * Events appended after throughSeq are never observed by this scan.
 */
export function visitEventSnapshot(input: {
  events: Pick<EventStore, "list">;
  throughSeq: number;
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
  while (afterSeq < input.throughSeq) {
    const page = input.events.list({ afterSeq, limit: pageSize });
    const snapshotPage = page.filter((event) => event.seq <= input.throughSeq);
    assertForwardPage(snapshotPage, afterSeq);
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
}
