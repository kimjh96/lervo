import { visitEventSnapshot, type EventStore } from "@lervo/storage-contract";

import { executionEventSource, executionEvidenceFailure } from "./execution-event-evidence.js";
import type { RepositoryKnowledgePolicy, RepositorySupplementalSource } from "./types.js";

const maximumSequence = 100_000;
const maximumPages = 4;
const maximumPageSources = 32_768;
const maximumPageBytes = 16 * 1024 * 1024;

/**
 * Pages become available only after the entire pinned canonical prefix is verified: the store
 * hash-checks each returned event and the snapshot traversal checks every link to the head.
 */
export function collectExecutionEventSourcePages(input: {
  events: Pick<EventStore, "latest" | "list">;
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
  try {
    const head = input.events.latest();
    if (head === null) return [];
    const latest = { seq: head.seq, projectId: head.projectId, eventHash: head.eventHash };
    if (!Number.isSafeInteger(latest.seq) || latest.seq < 1 || latest.seq > maximumSequence)
      return executionEvidenceFailure();
    visitEventSnapshot({
      events: input.events,
      throughSeq: latest.seq,
      throughHash: latest.eventHash,
      visit: (event) => {
        if (event.projectId !== latest.projectId || ids.has(event.eventId))
          return executionEvidenceFailure();
        ids.add(event.eventId);
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
    if (page.length !== 0) pages.push(page);
    return pages;
  } catch {
    return executionEvidenceFailure();
  }
}
