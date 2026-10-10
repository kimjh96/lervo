import type { EventWriterCoordinate } from "@lervo/schemas";

import { loadProjectManifest } from "./config.js";
import { contentHash } from "./filesystem.js";
import { readSmallEntry } from "./small-entry.js";
import {
  createEventWriterActivationPlan,
  createEventWriterRollbackPlan,
  type EventWriterActivationPlan,
} from "./event-writer-activation-plan.js";
import {
  defaultEventWriterCoordinate,
  readEventWriterCoordinate,
} from "./event-writer-coordinate-contract.js";
import { EventWriterActivationError } from "./event-writer-errors.js";
import {
  assertNoEventWriterActivationTransaction,
  maximumEventWriterCoordinateBytes,
} from "./event-writer-activation-transaction-io.js";
import { resolveProjectPaths } from "./layout.js";

async function readCoordinateFile(
  path: string,
  projectId: string,
): Promise<{
  coordinate: EventWriterCoordinate;
  contentHash: string | null;
  source: "implicit_default" | "managed_file";
}> {
  const entry = await readSmallEntry(path, maximumEventWriterCoordinateBytes);
  if (entry.kind === "missing") {
    return {
      coordinate: defaultEventWriterCoordinate(projectId),
      contentHash: null,
      source: "implicit_default",
    };
  }
  if (entry.kind !== "file") {
    throw new EventWriterActivationError(
      "event_writer_coordinate_invalid",
      "The event writer coordinate must be a bounded regular file.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(entry.content);
  } catch (error) {
    throw new EventWriterActivationError(
      "event_writer_coordinate_invalid",
      "The event writer coordinate is not valid JSON.",
      { cause: error },
    );
  }
  return {
    coordinate: readEventWriterCoordinate(value, projectId),
    contentHash: contentHash(entry.content),
    source: "managed_file",
  };
}

export async function inspectEventWriterCoordinate(repositoryRoot: string) {
  const manifest = await loadProjectManifest(repositoryRoot);
  const paths = resolveProjectPaths(repositoryRoot);
  await assertNoEventWriterActivationTransaction(paths.data);
  return {
    repositoryRoot: paths.repositoryRoot,
    projectId: manifest.projectId,
    ...(await readCoordinateFile(paths.eventContract, manifest.projectId)),
  };
}

export async function planEventWriterActivation(input: {
  repositoryRoot: string;
  evidence: unknown;
  targetEventSchemaVersion?: 2 | 3 | 4 | 5 | 6;
}): Promise<EventWriterActivationPlan> {
  const manifest = await loadProjectManifest(input.repositoryRoot);
  const paths = resolveProjectPaths(input.repositoryRoot);
  await assertNoEventWriterActivationTransaction(paths.data);
  const current = await readCoordinateFile(paths.eventContract, manifest.projectId);
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
  const current = await readCoordinateFile(paths.eventContract, manifest.projectId);
  return createEventWriterRollbackPlan({
    repositoryRoot: paths.repositoryRoot,
    projectId: manifest.projectId,
    currentCoordinate: current.coordinate,
    currentContentHash: current.contentHash,
  });
}
