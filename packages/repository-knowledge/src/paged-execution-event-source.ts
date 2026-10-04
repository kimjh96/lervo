import { computeEventHash, eventWithoutHash } from "@lervo/event-contract";
import { validateSchema } from "@lervo/schemas";
import { visitEventSnapshot, type EventStore } from "@lervo/storage-contract";

import { executionEventSource, executionEvidenceFailure } from "./execution-event-evidence.js";
import type { RepositoryKnowledgePolicy, RepositorySupplementalSource } from "./types.js";

const maximumSequence = 100_000;
const maximumPages = 4;
const maximumPageSources = 32_768;
const maximumPageBytes = 16 * 1024 * 1024;

/** Pages become available only after the entire pinned canonical prefix is verified. */
export function collectExecutionEventSourcePages(input: {
  events: Pick<EventStore, "latest" | "list" | "verifyIntegrity">;
  limits: Pick<RepositoryKnowledgePolicy["limits"], "maxFiles" | "maxTotalBytes">;
}): RepositorySupplementalSource[][] {
  for (const value of [input.limits.maxFiles, input.limits.maxTotalBytes])
    if (!Number.isSafeInteger(value) || value < 1)
      throw new TypeError("The execution evidence aggregate limit is invalid.");

  const pages: RepositorySupplementalSource[][] = [];
  const ids = new Set<string>();
  let page: RepositorySupplementalSource[] = [];
  let pageBytes = 0;
  let totalBytes = 0;
  let sourceCount = 0;
  let sequence = 0;
  let previousHash: string | null = null;
  try {
    if (!input.events.verifyIntegrity().valid) return executionEvidenceFailure();
    const head = input.events.latest();
    if (head === null) return [];
    const latest = { seq: head.seq, projectId: head.projectId, eventHash: head.eventHash };
    if (!Number.isSafeInteger(latest.seq) || latest.seq < 1 || latest.seq > maximumSequence)
      return executionEvidenceFailure();
    visitEventSnapshot({
      events: input.events,
      throughSeq: latest.seq,
      visit: (event) => {
        if (
          event.seq !== sequence + 1 ||
          event.previousHash !== previousHash ||
          event.projectId !== latest.projectId ||
          ids.has(event.eventId) ||
          !validateSchema("event", event).valid ||
          computeEventHash(eventWithoutHash(event)) !== event.eventHash
        )
          return executionEvidenceFailure();
        ids.add(event.eventId);
        sequence = event.seq;
        previousHash = event.eventHash;
        const source = executionEventSource(event);
        if (source === null) return;
        const bytes = Buffer.byteLength(source.content);
        if (page.length >= maximumPageSources || pageBytes + bytes > maximumPageBytes) {
          pages.push(page);
          page = [];
          pageBytes = 0;
        }
        totalBytes += bytes;
        if (
          pages.length >= maximumPages ||
          totalBytes > input.limits.maxTotalBytes ||
          sourceCount >= input.limits.maxFiles
        )
          return executionEvidenceFailure();
        page.push(source);
        sourceCount += 1;
        pageBytes += bytes;
      },
    });
    if (
      sequence !== latest.seq ||
      previousHash !== latest.eventHash ||
      !input.events.verifyIntegrity().valid
    )
      return executionEvidenceFailure();
    if (page.length !== 0) pages.push(page);
    return pages;
  } catch {
    return executionEvidenceFailure();
  }
}
