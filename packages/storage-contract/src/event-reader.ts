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
    throw new TypeError(`${label}은 1 이상의 안전한 정수여야 합니다.`);
  }
}

function assertForwardPage(
  page: readonly EventEnvelope[],
  afterSeq: number,
  expectedRunId?: string,
): void {
  let previousSeq = afterSeq;
  for (const event of page) {
    if (event.seq <= previousSeq || (expectedRunId !== undefined && event.runId !== expectedRunId)) {
      throw new EventReadError(
        "event_sequence_invalid",
        "Event 저장소가 요청 좌표에 맞는 순방향 page를 반환하지 않았습니다.",
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
  if (input.runId.length === 0) throw new TypeError("runId가 비어 있습니다.");
  assertPositiveSafeInteger(input.maximumEvents, "maximumEvents");
  const pageSize = input.pageSize ?? maximumPageSize;
  assertPositiveSafeInteger(pageSize, "pageSize");
  if (pageSize > maximumPageSize) throw new TypeError("pageSize는 1,000 이하여야 합니다.");

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
        `Run event가 허용된 ${input.maximumEvents}개를 넘었습니다.`,
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
    throw new TypeError("throughSeq는 0 이상의 안전한 정수여야 합니다.");
  }
  const pageSize = input.pageSize ?? maximumPageSize;
  assertPositiveSafeInteger(pageSize, "pageSize");
  if (pageSize > maximumPageSize) throw new TypeError("pageSize는 1,000 이하여야 합니다.");

  let afterSeq = 0;
  while (afterSeq < input.throughSeq) {
    const page = input.events.list({ afterSeq, limit: pageSize });
    const snapshotPage = page.filter((event) => event.seq <= input.throughSeq);
    assertForwardPage(snapshotPage, afterSeq);
    const next = snapshotPage.at(-1)?.seq;
    if (next === undefined) {
      throw new EventReadError(
        "event_sequence_invalid",
        "Event snapshot을 지정된 sequence까지 읽지 못했습니다.",
      );
    }
    snapshotPage.forEach(input.visit);
    afterSeq = next;
  }
}
