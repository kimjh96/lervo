import {
  type EventSyncAcknowledgement,
  type OutboundEventBatch,
  type ProjectRegistrationRequest,
  type ProjectRegistrationResponse,
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

/** Operational checks are deliberately separate from the request path. */
export interface HubSyncIntegrityStore {
  checkIntegrity(): Promise<HubSyncIntegrityReport>;
  auditIntegrity(): Promise<HubSyncIntegrityReport>;
}

export interface HubSyncLifecycle {
  close(): Promise<void>;
}
