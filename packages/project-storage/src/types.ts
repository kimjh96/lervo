import { type LervoProjectPaths } from "@lervo/project";
import { type ProjectManifest } from "@lervo/schemas";
import { type ArtifactStore, type OutboxStore } from "@lervo/storage-contract";

export type ProjectStorageErrorCode =
  | "cleanup_failed"
  | "coordination_busy"
  | "coordination_home_invalid"
  | "coordination_migration_conflict"
  | "coordination_state_conflict"
  | "storage_layout_invalid"
  | "storage_binding_changed"
  | "storage_writer_not_active"
  | "storage_busy";

export class ProjectStorageError extends Error {
  constructor(
    readonly code: ProjectStorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProjectStorageError";
  }
}

export interface CloseableArtifactStore extends ArtifactStore {
  close?(): void | Promise<void>;
}

export interface ProjectStorageBackends {
  openEventStore(options: {
    path: string;
    projectId: string;
    writableEventSchemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7;
    reportStorage?: "sqlite_v1";
  }): Promise<OutboxStore>;
  openArtifactStore(root: string): Promise<CloseableArtifactStore>;
}

export interface ProjectStorage {
  readonly readOnly?: boolean;
  readonly reportStorageCoordinateHash?: string | null;
  readonly manifest: ProjectManifest;
  readonly paths: LervoProjectPaths;
  readonly writableEventSchemaVersion?: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  readonly events: OutboxStore;
  readonly artifacts: CloseableArtifactStore;
  close(): Promise<void>;
}

export interface RepositoryCoordinationHome {
  schemaVersion: 1;
  repositoryInstanceId: string;
  storageKind: "git_common_directory" | "standalone_checkout";
  root: string;
  workforce: string;
  workspaces: string;
  integrations: string;
  integrationAttempts: string;
  cleanupJournals: string;
  events: string;
  locks: string;
}

export type RepositoryCoordinationCollection =
  "workspaces" | "integrations" | "integrationAttempts" | "cleanupJournals" | "events";

export interface RepositoryCoordinationRecord<T> {
  value: T;
  contentHash: string;
}
