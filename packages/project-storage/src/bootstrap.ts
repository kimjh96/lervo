import { FileSystemCas } from "@lervo/cas";
import { mkdir } from "node:fs/promises";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import {
  inspectEventWriterCoordinate,
  loadProjectManifest,
  resolveProjectPaths,
} from "@lervo/project";
import { type OutboxStore } from "@lervo/storage-contract";

import { validateProjectStorageLayout, validateRepositoryRoot } from "./layout.js";
import { migrateLegacyDurableState } from "./durable-layout.js";
import {
  type CloseableArtifactStore,
  type ProjectStorage,
  type ProjectStorageBackends,
  ProjectStorageError,
} from "./types.js";

const defaultBackends: ProjectStorageBackends = {
  openEventStore: (options) => SQLiteEventStore.open(options),
  openArtifactStore: (root) => FileSystemCas.open(root),
};

async function closeResources(
  events: OutboxStore,
  artifacts?: CloseableArtifactStore,
): Promise<void> {
  const errors: unknown[] = [];
  if (artifacts?.close) {
    try {
      await artifacts.close();
    } catch (error) {
      errors.push(error);
    }
  }
  try {
    events.close();
  } catch (error) {
    errors.push(error);
  }
  if (errors.length > 0) {
    throw new ProjectStorageError(
      "cleanup_failed",
      "Not all project storage resources could be closed.",
      { cause: new AggregateError(errors) },
    );
  }
}

class OpenedProjectStorage implements ProjectStorage {
  private closePromise: Promise<void> | undefined;

  constructor(
    readonly manifest: ProjectStorage["manifest"],
    readonly paths: ProjectStorage["paths"],
    readonly writableEventSchemaVersion: 1 | 2 | 3,
    readonly events: OutboxStore,
    readonly artifacts: CloseableArtifactStore,
    readonly readOnly = false,
  ) {}

  close(): Promise<void> {
    this.closePromise ??= closeResources(this.events, this.artifacts);
    return this.closePromise;
  }
}

export function createProjectStorageOpener(
  backends: ProjectStorageBackends,
): (root: string) => Promise<ProjectStorage> {
  return async (root: string): Promise<ProjectStorage> => {
    const paths = resolveProjectPaths(root);
    await validateRepositoryRoot(paths);
    const manifest = await loadProjectManifest(paths.repositoryRoot);
    await Promise.all([
      mkdir(paths.data, { recursive: true, mode: 0o700 }),
      mkdir(paths.state, { recursive: true, mode: 0o700 }),
    ]);
    await validateProjectStorageLayout(paths);
    await migrateLegacyDurableState(paths, manifest.projectId);
    await validateProjectStorageLayout(paths);
    const writerCoordinate = await inspectEventWriterCoordinate(paths.repositoryRoot);
    const events = await backends.openEventStore({
      path: paths.eventDatabase,
      projectId: manifest.projectId,
      writableEventSchemaVersion: writerCoordinate.coordinate.selectedEventSchemaVersion,
    });
    try {
      const artifacts = await backends.openArtifactStore(paths.cas);
      return new OpenedProjectStorage(
        manifest,
        paths,
        writerCoordinate.coordinate.selectedEventSchemaVersion,
        events,
        artifacts,
      );
    } catch (openError) {
      try {
        await closeResources(events);
      } catch (cleanupError) {
        throw new ProjectStorageError(
          "cleanup_failed",
          "Artifact storage failed to open, and event storage also failed to close.",
          { cause: new AggregateError([openError, cleanupError]) },
        );
      }
      throw openError;
    }
  };
}

export const openProjectStorage = createProjectStorageOpener(defaultBackends);

/** Observes a peer repository with existing stores; the owning Node retains every write and migration. */
export async function openReadOnlyProjectStorage(root: string): Promise<ProjectStorage> {
  const paths = resolveProjectPaths(root);
  await validateRepositoryRoot(paths);
  const manifest = await loadProjectManifest(paths.repositoryRoot);
  await validateProjectStorageLayout(paths);
  const writer = await inspectEventWriterCoordinate(paths.repositoryRoot);
  const events = await SQLiteEventStore.openReadOnly({
    path: paths.eventDatabase,
    projectId: manifest.projectId,
  });
  try {
    const artifacts = await FileSystemCas.openReadOnly(paths.cas);
    return new OpenedProjectStorage(
      manifest,
      paths,
      writer.coordinate.selectedEventSchemaVersion,
      events,
      artifacts,
      true,
    );
  } catch (openError) {
    try {
      await closeResources(events);
    } catch (cleanupError) {
      throw new ProjectStorageError(
        "cleanup_failed",
        "Read-only artifact storage failed to open, and event storage also failed to close.",
        { cause: new AggregateError([openError, cleanupError]) },
      );
    }
    throw openError;
  }
}
