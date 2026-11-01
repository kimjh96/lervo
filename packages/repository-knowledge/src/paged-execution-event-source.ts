import { visitEventSnapshot, type EventStore } from "@lervo/storage-contract";

import { executionEvidenceFailure } from "./execution-event-evidence.js";
import { ExecutionEventWindow } from "./execution-event-window.js";
import type { RepositoryKnowledgePolicy, RepositorySupplementalSource } from "./types.js";

const maximumPages = 4;
const maximumPageSources = 32_768;
const maximumPageBytes = 16 * 1024 * 1024;

/**
 * Fills at most four pages from the newest source backwards. Greedy filling from one end retains
 * the longest suffix that fits, so the oldest sources that would need a fifth page are left out.
 */
function newestPages(window: readonly RepositorySupplementalSource[]) {
  const pages: RepositorySupplementalSource[][] = [];
  let page: RepositorySupplementalSource[] = [];
  let pageBytes = 0;
  for (let index = window.length - 1; index >= 0; index -= 1) {
    const source = window[index]!;
    const bytes = Buffer.byteLength(source.content);
    if (page.length >= maximumPageSources || pageBytes + bytes > maximumPageBytes) {
      pages.push(page.reverse());
      if (pages.length >= maximumPages) return pages.reverse();
      page = [];
      pageBytes = 0;
    }
    page.push(source);
    pageBytes += bytes;
  }
  if (page.length !== 0) pages.push(page.reverse());
  return pages.reverse();
}

/**
 * Pages become available only after the entire pinned canonical prefix is verified: the store
 * hash-checks each returned event and the snapshot traversal checks every link to the head.
 *
 * ADR-0554: the pages hold the most recent execution events through that head that fit the four
 * pages and the tracked policy's source-count and aggregate-byte ceilings. A longer history selects
 * this deterministic window instead of failing; older execution events are still validated but
 * not returned, so the pages are partial evidence whenever history outgrows them.
 */
export function collectExecutionEventSourcePages(input: {
  events: Pick<EventStore, "latest" | "list">;
  limits: Pick<RepositoryKnowledgePolicy["limits"], "maxFiles" | "maxTotalBytes">;
}): RepositorySupplementalSource[][] {
  for (const value of [input.limits.maxFiles, input.limits.maxTotalBytes])
    if (!Number.isSafeInteger(value) || value < 1)
      throw new TypeError("The execution evidence aggregate limit is invalid.");

  const window = new ExecutionEventWindow(
    Math.min(maximumPages * maximumPageSources, input.limits.maxFiles),
    Math.min(maximumPages * maximumPageBytes, input.limits.maxTotalBytes),
  );
  try {
    const head = input.events.latest();
    if (head === null) return [];
    const latest = { seq: head.seq, projectId: head.projectId, eventHash: head.eventHash };
    if (!Number.isSafeInteger(latest.seq) || latest.seq < 1) return executionEvidenceFailure();
    visitEventSnapshot({
      events: input.events,
      throughSeq: latest.seq,
      throughHash: latest.eventHash,
      visit: (event) => {
        if (event.projectId !== latest.projectId) return executionEvidenceFailure();
        window.observe(event);
      },
    });
    return newestPages(window.sources());
  } catch {
    return executionEvidenceFailure();
  }
}
