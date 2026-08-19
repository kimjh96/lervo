import { type ProjectSyncState } from "@lervo/sync-contract";

export interface HubProjectCoordinate {
  destinationId: string;
  projectId: string;
}

export interface HubSyncIntegrityReport {
  valid: true;
  projectCount: number;
  eventCount: number;
}

export interface HubSyncTransaction {
  loadProject(coordinate: HubProjectCoordinate): ProjectSyncState | null;
  saveProject(state: ProjectSyncState): void;
}

/** The callback is synchronous so the response cannot escape before commit. */
export interface HubSyncStore {
  transact<T>(work: (transaction: HubSyncTransaction) => T): T;
  getProject(coordinate: HubProjectCoordinate): ProjectSyncState | null;
  listProjectCoordinates(): HubProjectCoordinate[];
  verifyIntegrity(): HubSyncIntegrityReport;
  close(): void;
}
