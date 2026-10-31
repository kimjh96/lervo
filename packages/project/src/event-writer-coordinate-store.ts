import { readEventWriterCoordinateFile } from "./event-writer-coordinate-reader.js";
import { loadProjectManifest } from "./config.js";
import {
  createEventWriterActivationPlan,
  createEventWriterRollbackPlan,
  type EventWriterActivationPlan,
} from "./event-writer-activation-plan.js";
import { assertNoEventWriterActivationTransaction } from "./event-writer-activation-transaction-io.js";
import { resolveProjectPaths } from "./layout.js";

export async function inspectEventWriterCoordinate(repositoryRoot: string) {
  const manifest = await loadProjectManifest(repositoryRoot);
  const paths = resolveProjectPaths(repositoryRoot);
  await assertNoEventWriterActivationTransaction(paths.data);
  return {
    repositoryRoot: paths.repositoryRoot,
    projectId: manifest.projectId,
    ...(await readEventWriterCoordinateFile(paths.eventContract, manifest.projectId)),
  };
}

export async function planEventWriterActivation(input: {
  repositoryRoot: string;
  evidence: unknown;
  targetEventSchemaVersion?: 2 | 3 | 4 | 5 | 6 | 7 | 8;
}): Promise<EventWriterActivationPlan> {
  const manifest = await loadProjectManifest(input.repositoryRoot);
  const paths = resolveProjectPaths(input.repositoryRoot);
  await assertNoEventWriterActivationTransaction(paths.data);
  const current = await readEventWriterCoordinateFile(paths.eventContract, manifest.projectId);
  return createEventWriterActivationPlan({
    repositoryRoot: paths.repositoryRoot,
    projectId: manifest.projectId,
    hubSyncEnabled: manifest.dataPolicy.hubSyncEnabled,
    currentCoordinate: current.coordinate,
    currentContentHash: current.contentHash,
    evidence: input.evidence,
    ...(input.targetEventSchemaVersion === undefined
      ? {}
      : { targetEventSchemaVersion: input.targetEventSchemaVersion }),
  });
}

export async function planEventWriterRollback(
  repositoryRoot: string,
): Promise<EventWriterActivationPlan> {
  const manifest = await loadProjectManifest(repositoryRoot);
  const paths = resolveProjectPaths(repositoryRoot);
  await assertNoEventWriterActivationTransaction(paths.data);
  const current = await readEventWriterCoordinateFile(paths.eventContract, manifest.projectId);
  return createEventWriterRollbackPlan({
    repositoryRoot: paths.repositoryRoot,
    projectId: manifest.projectId,
    currentCoordinate: current.coordinate,
    currentContentHash: current.contentHash,
  });
}
