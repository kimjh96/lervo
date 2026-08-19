import { type HubProjectCoordinate } from "@lervo/hub-sync";
import { type EventEnvelope, type EventSyncCursor } from "@lervo/schemas";

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
  firstSeq: number;
  lastSeq: number;
  firstOccurredAt: string;
  lastOccurredAt: string;
  eventCount: number;
  continuousEventCount: number;
  bufferedEventCount: number;
}

export interface HubProjectTrace {
  project: HubProjectTraceSummary;
  runs: HubRunTraceSummary[];
}

export interface HubRunTraceEvent {
  chainPosition: TraceChainPosition;
  event: EventEnvelope;
}

export interface HubRunTrace {
  project: HubProjectTraceSummary;
  run: HubRunTraceSummary;
  events: HubRunTraceEvent[];
}
