import type { EventEnvelope } from "@lervo/schemas";

import { executionEventSource, executionEvidenceFailure } from "./execution-event-evidence.js";
import type { RepositorySupplementalSource } from "./types.js";

/**
 * ADR-0554: retains the most recent execution-event sources of a snapshot within a count and byte
 * bound instead of failing when history outgrows them. Every observed execution event is still
 * validated, including events that later leave the window. After each observation the window is
 * the longest suffix of selected sources within both bounds, so it is deterministic for the head.
 */
export class ExecutionEventWindow {
  private window: (RepositorySupplementalSource | undefined)[] = [];
  private readonly ids = new Set<string>();
  private bytes = 0;
  private first = 0;
  private evicted = 0;

  constructor(
    private readonly maximumEvents: number,
    private readonly maximumBytes: number,
  ) {
    for (const value of [maximumEvents, maximumBytes])
      if (!Number.isSafeInteger(value) || value < 1)
        throw new TypeError("The execution event window limit is invalid.");
  }

  observe(event: EventEnvelope): void {
    const source = executionEventSource(event);
    if (source === null) return;
    if (this.ids.has(event.eventId)) return executionEvidenceFailure();
    const sourceBytes = Buffer.byteLength(source.content);
    while (
      this.first < this.window.length &&
      (this.window.length - this.first >= this.maximumEvents ||
        this.bytes + sourceBytes > this.maximumBytes)
    )
      this.evictOldest();
    if (sourceBytes > this.maximumBytes) {
      this.evicted += 1;
      return;
    }
    this.window.push(source);
    this.ids.add(event.eventId);
    this.bytes += sourceBytes;
  }

  /** False when any selected execution event was left outside the retained window. */
  complete(): boolean {
    return this.evicted === 0;
  }

  /** The retained window, oldest first. */
  sources(): RepositorySupplementalSource[] {
    return this.window.slice(this.first) as RepositorySupplementalSource[];
  }

  private evictOldest(): void {
    const removed = this.window[this.first]!;
    // Released slots hold no content, so evicted bytes never accumulate before compaction.
    this.window[this.first++] = undefined;
    this.bytes -= Buffer.byteLength(removed.content);
    this.ids.delete(removed.path.slice("@event/".length));
    this.evicted += 1;
    if (this.first >= 1_024 && this.first * 2 >= this.window.length) {
      this.window = this.window.slice(this.first);
      this.first = 0;
    }
  }
}
