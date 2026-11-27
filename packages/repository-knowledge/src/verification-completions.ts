import type { EventEnvelope } from "@lervo/schemas";
import { visitEventsOfTypes, type EventStore } from "@lervo/storage-contract";

const MAX_RESULTS = 256;
const COMPLETED_TYPES = ["verification.completed"] as const;

/** An unverifiable completion history; callers translate it into their own evidence error. */
export class VerificationHistoryError extends Error {
  constructor() {
    super("The verification completion history is invalid.");
    this.name = "VerificationHistoryError";
  }
}

function fail(): never {
  throw new VerificationHistoryError();
}

function completedId(event: EventEnvelope): string {
  const verificationId = event.payload.verificationId;
  return typeof verificationId === "string" ? verificationId : fail();
}

function sameCompletion(left: EventEnvelope, right: EventEnvelope): boolean {
  return JSON.stringify(left.payload) === JSON.stringify(right.payload);
}

/**
 * ADR-0554: selects, newest first, the latest completion of the most recent MAX_RESULTS distinct
 * verifications through the observed head with a typed read, so history length never bounds it.
 * Every completion is shape-checked, and every completion of a selected verification must agree.
 */
export function recentVerificationCompletions(
  events: Pick<EventStore, "list">,
  throughSeq: number,
): EventEnvelope[] {
  const selected = new Map<string, EventEnvelope>();
  let evicted = false;
  visitEventsOfTypes({
    events,
    types: COMPLETED_TYPES,
    throughSeq,
    visit: (event) => {
      const verificationId = completedId(event);
      const previous = selected.get(verificationId);
      if (previous !== undefined && !sameCompletion(previous, event)) return fail();
      // Re-inserting keeps the map ordered by each verification's latest completion.
      selected.delete(verificationId);
      selected.set(verificationId, event);
      if (selected.size <= MAX_RESULTS) return;
      selected.delete(selected.keys().next().value!);
      evicted = true;
    },
  });
  // A verification selected again after eviction has earlier completions that were not compared.
  if (evicted)
    visitEventsOfTypes({
      events,
      types: COMPLETED_TYPES,
      throughSeq,
      visit: (event) => {
        const retained = selected.get(completedId(event));
        if (retained !== undefined && !sameCompletion(retained, event)) fail();
      },
    });
  return [...selected.values()].reverse();
}
