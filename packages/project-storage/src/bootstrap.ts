import { FileSystemCas } from "@lervo/cas";
import { mkdir } from "node:fs/promises";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import {
  inspectProjectStorageCoordinates,
  loadProjectManifest,
  resolveProjectPaths,
} from "@lervo/project";
import { type OutboxStore } from "@lervo/storage-contract";

import { validateProjectStorageLayout, validateRepositoryRoot } from "./layout.js";
import { withReportReader } from "./report-artifact-reader.js";
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
    readonly writableEventSchemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8,
    readonly events: OutboxStore,
    readonly artifacts: CloseableArtifactStore,
    readonly readOnly = false,
    readonly reportStorageCoordinateHash: string | null = null,
  ) {}

  close(): Promise<void> {
    this.closePromise ??= closeResources(this.events, this.artifacts);
    return this.closePromise;
  }
}

function assertOpeningProject(openingProjectId: string, currentProjectId: string): void {
  if (openingProjectId !== currentProjectId)
    throw new ProjectStorageError(
      "storage_binding_changed",
      "The project changed during storage opening.",
    );
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
    const { writer: writerCoordinate, reports: reportSelection } =
      await inspectProjectStorageCoordinates(paths.repositoryRoot);
    assertOpeningProject(manifest.projectId, writerCoordinate.projectId);
    const events = await backends.openEventStore({
      path: paths.eventDatabase,
      projectId: manifest.projectId,
      writableEventSchemaVersion: writerCoordinate.coordinate.selectedEventSchemaVersion,
      ...(reportSelection.coordinate && writerCoordinate.coordinate.selectedEventSchemaVersion >= 6
        ? { reportStorage: "sqlite_v1" as const }
        : {}),
    });
    try {
      if (
        reportSelection.coordinate &&
        writerCoordinate.coordinate.selectedEventSchemaVersion >= 6 &&
        !events.reportWriter
      )
        throw new ProjectStorageError(
          "storage_layout_invalid",
          "The backend cannot honor the selected report storage contract.",
        );
      const artifacts = await backends.openArtifactStore(paths.cas);
      return new OpenedProjectStorage(
        manifest,
        paths,
        writerCoordinate.coordinate.selectedEventSchemaVersion,
        events,
        withReportReader(artifacts, events.reports),
        false,
        reportSelection.contentHash,
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

/** Selected report writers amortize checkpoints; ordinary pooled event writers checkpoint each commit. */
export const openPooledProjectStorage = createProjectStorageOpener({
  ...defaultBackends,
  openEventStore: (options) =>
    SQLiteEventStore.open({
      ...options,
      checkpointPolicy: "report_batches",
      ...(!options.reportStorage && options.writableEventSchemaVersion >= 6
        ? { reportStorage: "existing_sqlite_v1" as const }
        : {}),
    }),
});

/** Observes a peer repository with existing stores; the owning Node retains every write and migration. */
export async function openReadOnlyProjectStorage(root: string): Promise<ProjectStorage> {
  const paths = resolveProjectPaths(root);
  await validateRepositoryRoot(paths);
  const manifest = await loadProjectManifest(paths.repositoryRoot);
  await validateProjectStorageLayout(paths);
  const { writer, reports: reportSelection } = await inspectProjectStorageCoordinates(
    paths.repositoryRoot,
  );
  assertOpeningProject(manifest.projectId, writer.projectId);
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
      withReportReader(artifacts, events.reports),
      true,
      reportSelection.contentHash,
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
