import { type LervoProjectPaths } from "@lervo/project";
import { type ProjectManifest } from "@lervo/schemas";
import { type ArtifactStore, type OutboxStore } from "@lervo/storage-contract";

export type ProjectStorageErrorCode =
  | "cleanup_failed"
  | "coordination_busy"
  | "coordination_home_invalid"
  | "coordination_migration_conflict"
  | "coordination_state_conflict"
  | "storage_layout_invalid";

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
  openEventStore(options: { path: string; projectId: string }): Promise<OutboxStore>;
  openArtifactStore(root: string): Promise<CloseableArtifactStore>;
}

export interface ProjectStorage {
  readonly manifest: ProjectManifest;
  readonly paths: LervoProjectPaths;
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
  cleanupJournals: string;
  events: string;
  locks: string;
}

export type RepositoryCoordinationCollection =
  "workspaces" | "integrations" | "cleanupJournals" | "events";

export interface RepositoryCoordinationRecord<T> {
  value: T;
  contentHash: string;
}
