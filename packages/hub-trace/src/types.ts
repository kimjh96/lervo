import { type HubProjectCoordinate } from "@lervo/hub-sync";
import type { KnowledgeGraphNode, KnowledgeGraphRelation } from "@lervo/knowledge-graph";
import {
  type EventEnvelope,
  type EventSyncCursor,
  type ManagedContextCoverageReport,
} from "@lervo/schemas";

export type TraceChainPosition = "continuous" | "buffered";

export interface HubProjectTraceSummary extends HubProjectCoordinate {
  projectName: string;
  registrationId: string;
  projectIdentityHash: string;
  projectManifestHash: string;
  registeredAt: string;
  updatedAt: string;
  cursor: EventSyncCursor;
  storedEventCount: number;
  continuousEventCount: number;
  bufferedEventCount: number;
  runCount: number;
}

export interface HubRunTraceSummary {
  runId: string;
  sessionIds: string[];
  sessionCount: number;
  sessionIdsTruncated: boolean;
  firstSeq: number;
  lastSeq: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  eventCount: number;
  continuousEventCount: number;
  bufferedEventCount: number;
}

export interface HubProjectTraceCursor extends HubProjectCoordinate {}

export interface HubRunTraceCursor {
  firstSeq: number;
  runId: string;
}

export interface HubEventTraceCursor {
  seq: number;
}

export interface HubKnowledgeGraphCursor {
  relationId: string;
}

export type HubTraceProjectScope =
  | { mode: "all" }
  | { mode: "projects"; projects: HubProjectCoordinate[] };

export interface HubTracePage<T, Cursor> {
  items: T[];
  nextCursor: Cursor | null;
}

export interface HubProjectTrace {
  project: HubProjectTraceSummary;
  runs: HubTracePage<HubRunTraceSummary, HubRunTraceCursor>;
}

export interface HubRunTraceEvent {
  chainPosition: TraceChainPosition;
  event: EventEnvelope;
}

export interface HubRunTrace {
  project: HubProjectTraceSummary;
  run: HubRunTraceSummary;
  events: HubTracePage<HubRunTraceEvent, HubEventTraceCursor>;
  contextCoverage: ManagedContextCoverageReport | null;
}

export interface HubProjectKnowledgeGraph {
  project: HubProjectTraceSummary;
  focus: KnowledgeGraphNode;
  relations: HubTracePage<KnowledgeGraphRelation, HubKnowledgeGraphCursor>;
}

export interface HubProjectTraceQuery {
  after?: HubProjectTraceCursor;
  limit?: number;
}

export interface HubProjectRunQuery extends HubProjectCoordinate {
  after?: HubRunTraceCursor;
  limit?: number;
}

export interface HubRunEventQuery extends HubProjectCoordinate {
  runId: string;
  after?: HubEventTraceCursor;
  limit?: number;
}

export interface HubKnowledgeGraphQuery extends HubProjectCoordinate {
  focus: KnowledgeGraphNode;
  after?: HubKnowledgeGraphCursor;
  limit?: number;
}

export interface ResolvedHubProjectTraceQuery {
  scope: HubTraceProjectScope;
  after?: HubProjectTraceCursor;
  limit: number;
}

export interface ResolvedHubProjectRunQuery extends HubProjectCoordinate {
  scope: HubTraceProjectScope;
  after?: HubRunTraceCursor;
  limit: number;
}

export interface ResolvedHubRunEventQuery extends HubProjectCoordinate {
  scope: HubTraceProjectScope;
  runId: string;
  after?: HubEventTraceCursor;
  limit: number;
}

export interface ResolvedHubKnowledgeGraphQuery extends HubProjectCoordinate {
  scope: HubTraceProjectScope;
  focus: KnowledgeGraphNode;
  after?: HubKnowledgeGraphCursor;
  limit: number;
}
