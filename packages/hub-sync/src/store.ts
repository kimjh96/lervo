import {
  type EventSyncAcknowledgement,
  type OutboundEventBatch,
  type ProjectRegistrationRequest,
  type ProjectRegistrationResponse,
  type WorkstreamReplicationPublishRequest,
  type WorkstreamReplicationPublishResponse,
  type WorkstreamReplicationReadResponse,
  type WorkstreamReplicationRevisionResponse,
} from "@lervo/schemas";

export interface HubProjectCoordinate {
  destinationId: string;
  projectId: string;
}

export interface HubSyncIntegrityReport {
  valid: true;
  projectCount: number;
  eventCount: number;
}

/** Command-side application port. Implementations resolve only after commit. */
export interface HubSyncCommandStore {
  registerProject(input: {
    request: ProjectRegistrationRequest;
    acceptedAt: string;
  }): Promise<ProjectRegistrationResponse>;

  acceptEventBatch(input: {
    batch: OutboundEventBatch;
    acknowledgedAt: string;
  }): Promise<EventSyncAcknowledgement>;
}

export interface HubWorkstreamReplicationStore {
  publishWorkstream(input: {
    destinationId: string;
    request: WorkstreamReplicationPublishRequest;
    publishedAt: string;
  }): Promise<WorkstreamReplicationPublishResponse>;

  readWorkstream(input: {
    destinationId: string;
    projectId: string;
    repositoryIdentityHash: string;
  }): Promise<WorkstreamReplicationReadResponse>;

  /** ADR-0561: one immutable stored revision, head or not, by its exact content hash. */
  readWorkstreamRevision(input: {
    destinationId: string;
    projectId: string;
    repositoryIdentityHash: string;
    snapshotContentHash: string;
  }): Promise<WorkstreamReplicationRevisionResponse>;
}

/** Operational checks are deliberately separate from the request path. */
export interface HubSyncIntegrityStore {
  checkIntegrity(): Promise<HubSyncIntegrityReport>;
  auditIntegrity(): Promise<HubSyncIntegrityReport>;
}

export interface HubSyncLifecycle {
  close(): Promise<void>;
}
