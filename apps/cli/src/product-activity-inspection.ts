import { captureRepositorySnapshot } from "@lervo/orchestrator";
import {
  activityCursorFromEventHash,
  projectActivityPage,
} from "@lervo/product-surface-projection";
import { openReadOnlyProjectStorage } from "@lervo/project-storage";
import type { EventEnvelope, ProductActivityPageV1 } from "@lervo/schemas";
import type { EventChainReport, ListEventsOptions } from "@lervo/storage-contract";

const cursorScanPageSize = 1_000;

interface ActivityEventSource {
  list(options?: ListEventsOptions): EventEnvelope[];
  verifyIntegrity(): EventChainReport;
}

interface ActivityStorage {
  readonly events: ActivityEventSource;
  close(): Promise<void>;
}

interface ProductActivityInspectionDependencies {
  openStorage(root: string): Promise<ActivityStorage>;
  captureSnapshot(root: string): Promise<{ revision: string }>;
}

export interface ProductActivityInspectionInput {
  repositoryRoot: string;
  cursor: string | null;
  limit: number;
}

export type InspectProductActivity = (
  input: ProductActivityInspectionInput,
) => Promise<ProductActivityPageV1>;

const defaultDependencies: ProductActivityInspectionDependencies = {
  openStorage: openReadOnlyProjectStorage,
  captureSnapshot: captureRepositorySnapshot,
};

function findCursorAnchor(
  events: ActivityEventSource,
  cursor: string,
  eventCount: number,
): { eventHash: string; sequence: number } | null {
  let afterSeq = 0;
  while (afterSeq < eventCount) {
    const page = events.list({
      afterSeq,
      limit: Math.min(cursorScanPageSize, eventCount - afterSeq),
    });
    if (page.length === 0) break;
    for (const event of page) {
      if (event.seq > eventCount) break;
      if (activityCursorFromEventHash(event.eventHash) === cursor) {
        return { eventHash: event.eventHash, sequence: event.seq };
      }
    }
    afterSeq = page.at(-1)!.seq;
  }
  return null;
}

export async function inspectProductActivity(
  input: ProductActivityInspectionInput,
  dependencies: ProductActivityInspectionDependencies = defaultDependencies,
): Promise<ProductActivityPageV1> {
  const storage = await dependencies.openStorage(input.repositoryRoot);
  try {
    const integrity = storage.events.verifyIntegrity();
    if (integrity.headHash === null || integrity.eventCount === 0) {
      throw new Error("No canonical events exist for product activity projection.");
    }
    const repository = await dependencies.captureSnapshot(input.repositoryRoot);
    const matchedAnchor =
      input.cursor === null
        ? { eventHash: null, sequence: 0 }
        : findCursorAnchor(storage.events, input.cursor, integrity.eventCount);
    const anchor = matchedAnchor ?? {
      eventHash: integrity.headHash,
      sequence: integrity.eventCount,
    };
    const events =
      matchedAnchor === null && input.cursor !== null
        ? []
        : storage.events
            .list({ afterSeq: anchor.sequence, limit: input.limit + 1 })
            .filter((event) => event.seq <= integrity.eventCount);

    return projectActivityPage({
      sourceEventHeadHash: integrity.headHash,
      repositoryRevision: repository.revision,
      requestCursor: input.cursor,
      precedingEventHash: anchor.eventHash,
      precedingSequence: anchor.sequence,
      events,
      limit: input.limit,
    });
  } finally {
    await storage.close();
  }
}
