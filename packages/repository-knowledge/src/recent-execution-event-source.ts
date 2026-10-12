import type { EventStore } from "@lervo/storage-contract";
import { visitEventSnapshot } from "@lervo/storage-contract";
import type { EventEnvelope } from "@lervo/schemas";

import { executionEventSource, executionEvidenceFailure } from "./execution-event-evidence.js";
import type { RepositorySupplementalSource } from "./types.js";

const maximumWindowEvents = 32_768;
const maximumWindowBytes = 16 * 1024 * 1024;

/** Receives every event in a verified snapshot, including events outside the retained window. */
export class RecentExecutionEventProjection {
  private readonly window: RepositorySupplementalSource[] = [];
  private readonly ids = new Set<string>();
  private bytes = 0;
  private first = 0;

  constructor(private readonly maximumEvents: number) {
    if (
      !Number.isSafeInteger(maximumEvents) ||
      maximumEvents < 1 ||
      maximumEvents > maximumWindowEvents
    )
      throw new TypeError("The execution event window limit is invalid.");
  }

  observe(event: EventEnvelope): void {
    const source = executionEventSource(event);
    if (source === null) return;
    if (this.ids.has(event.eventId)) return executionEvidenceFailure();
    const sourceBytes = Buffer.byteLength(source.content);
    while (
      this.window.length - this.first >= this.maximumEvents ||
      this.bytes + sourceBytes > maximumWindowBytes
    ) {
      const removed = this.window[this.first++]!;
      this.bytes -= Buffer.byteLength(removed.content);
      this.ids.delete(removed.path.slice("@event/".length));
    }
    this.window.push(source);
    this.ids.add(event.eventId);
    this.bytes += sourceBytes;
    if (this.first >= this.maximumEvents) {
      this.window.splice(0, this.first);
      this.first = 0;
    }
  }

  sources(): RepositorySupplementalSource[] {
    return this.window.slice(this.first);
  }
}

/** A bounded interactive projection; it never establishes complete-history coverage. */
export function collectRecentExecutionEventSources(input: {
  events: Pick<EventStore, "latest" | "list">;
  maximumEvents: number;
}): RepositorySupplementalSource[] {
  const projection = new RecentExecutionEventProjection(input.maximumEvents);
  try {
    const latest = input.events.latest();
    if (latest === null) return [];
    if (!Number.isSafeInteger(latest.seq) || latest.seq < 1) return executionEvidenceFailure();
    visitEventSnapshot({
      events: input.events,
      throughSeq: latest.seq,
      throughHash: latest.eventHash,
      visit: (event) => projection.observe(event),
    });
    return projection.sources();
  } catch {
    return executionEvidenceFailure();
  }
}
