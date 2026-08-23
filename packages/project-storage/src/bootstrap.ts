import { FileSystemCas } from "@lervo/cas";
import { mkdir } from "node:fs/promises";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { loadProjectManifest, resolveProjectPaths } from "@lervo/project";
import { type OutboxStore } from "@lervo/storage-contract";

import { validateProjectStorageLayout, validateRepositoryRoot } from "./layout.js";
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
    readonly events: OutboxStore,
    readonly artifacts: CloseableArtifactStore,
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
    try {
      await mkdir(paths.state, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await validateProjectStorageLayout(paths);
    const events = await backends.openEventStore({
      path: paths.eventDatabase,
      projectId: manifest.projectId,
    });
    try {
      const artifacts = await backends.openArtifactStore(paths.cas);
      return new OpenedProjectStorage(manifest, paths, events, artifacts);
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
