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

export interface HubSyncReadView {
  loadProject(coordinate: HubProjectCoordinate): ProjectSyncState | null;
  listProjectCoordinates(): HubProjectCoordinate[];
}

export interface HubSyncTransaction extends HubSyncReadView {
  saveProject(state: ProjectSyncState): void;
}

/** The callback is synchronous so the response cannot escape before commit. */
export interface HubSyncStore {
  read<T>(work: (view: HubSyncReadView) => T): T;
  transact<T>(work: (transaction: HubSyncTransaction) => T): T;
  getProject(coordinate: HubProjectCoordinate): ProjectSyncState | null;
  listProjectCoordinates(): HubProjectCoordinate[];
  verifyIntegrity(): HubSyncIntegrityReport;
  close(): void;
}
