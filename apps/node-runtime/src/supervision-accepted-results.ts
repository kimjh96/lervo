import type { EventStore } from "@lervo/storage-contract";

import { VerifiedEventTail } from "./verified-event-tail.js";

const reviewTypes = ["work.supervision.review.recorded"] as const;
/** Review events one read may retain; the length of the surrounding history is never bounded. */
const maximumReviewEvents = 100_000;

/**
 * `<assignment>:<artifact>` pairs the owner accepted. A completed assignment only means the worker
 * returned a result; the owner may still reject it, so publication needs an accepted review that
 * names that exact result artifact.
 */
export function acceptedResultKeys(
  events: readonly { type: string; payload: unknown }[],
): Set<string> {
  const accepted = new Set<string>();
  for (const event of events) {
    if (event.type !== "work.supervision.review.recorded") continue;
    const payload = event.payload as {
      verdict?: unknown;
      assignmentIds?: unknown;
      artifactHashes?: unknown;
    };
    if (
      payload.verdict !== "accepted" ||
      !Array.isArray(payload.assignmentIds) ||
      !Array.isArray(payload.artifactHashes)
    )
      continue;
    for (const assignmentId of payload.assignmentIds)
      for (const artifact of payload.artifactHashes)
        accepted.add(`${String(assignmentId)}:${String(artifact)}`);
  }
  return accepted;
}

/**
 * Accepted result keys over the whole review history, read through a verified cursor. A key is
 * only ever added by a later review, so the union of the earlier keys and the appended tail's keys
 * equals one full scan; a restarted cursor discards the union and rescans everything.
 */
export class AcceptedSupervisionResults {
  private readonly tail: VerifiedEventTail;
  private accepted = new Set<string>();

  constructor(
    private readonly events: Pick<EventStore, "get" | "latest" | "list">,
    now?: () => number,
  ) {
    this.tail = new VerifiedEventTail({
      types: reviewTypes,
      maximumMatchedEvents: maximumReviewEvents,
      fullReadIntervalMs: 900_000,
      boundMessage: "The supervision review events exceed their observation bound.",
      ...(now === undefined ? {} : { now }),
    });
  }

  read(): ReadonlySet<string> {
    try {
      const read = this.tail.read(this.events);
      if (read.restarted) this.accepted = new Set();
      for (const key of acceptedResultKeys(read.events)) this.accepted.add(key);
      return new Set(this.accepted);
    } catch (error) {
      this.tail.reset();
      this.accepted = new Set();
      throw error;
    }
  }
}
