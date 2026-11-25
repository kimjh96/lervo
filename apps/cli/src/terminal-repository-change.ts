import { captureTerminalRepositorySnapshot } from "./terminal-repository-snapshot.js";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  appendRepositoryChange,
  planRepositoryChangeInRepository,
  type PlannedRepositoryChange,
  type RepositoryKnowledgeJobAdmission,
  type TerminalIntegrationProvider,
} from "@lervo/repository-knowledge";
import type { OutboxTransaction } from "@lervo/storage-contract";

import { terminalEventDraft } from "./terminal-event-coordinates.js";
import type {
  TerminalLifecycleInspection,
  UnmanagedTerminalCoordinates,
} from "./terminal-hook-contract.js";
import { readPreparedRepositorySnapshot } from "./terminal-prepared-snapshot.js";

/**
 * The durable background-knowledge source for a changed terminal turn (ADR-0433). It needs the
 * snapshot prepared at prompt submission and a v3 event writer; otherwise the turn records none.
 */
export async function plannedTerminalRepositoryChange(input: {
  root: string;
  storage: Pick<ProjectStorage, "writableEventSchemaVersion" | "artifacts"> &
    Partial<Pick<ProjectStorage, "manifest">>;
  contextPayload: Record<string, unknown>;
  lifecycle: TerminalLifecycleInspection;
  turnEventId: string;
  occurredAt: string;
}): Promise<PlannedRepositoryChange | null> {
  if (
    !input.lifecycle.repositoryChange.changed ||
    (input.storage.writableEventSchemaVersion ?? 1) < 3
  )
    return null;
  if (typeof input.contextPayload.observationId !== "string") return null;
  const before = await readPreparedRepositorySnapshot(
    input.root,
    input.contextPayload.observationId,
  );
  if (before === null || before.revision !== input.lifecycle.repositoryChange.beforeRevision)
    return null;
  const after = await captureTerminalRepositorySnapshot(input.root);
  // A change after lifecycle inspection belongs to the next observed turn.
  if (after.revision !== input.lifecycle.repositoryChange.afterRevision) return null;
  const planned = await planRepositoryChangeInRepository({
    repositoryRoot: input.root,
    ...(input.storage.manifest === undefined
      ? {}
      : { projectId: input.storage.manifest.projectId }),
    sourceKind: "terminal_turn",
    sourceEventId: input.turnEventId,
    before,
    after,
    occurredAt: input.occurredAt,
  });
  if (planned === null) return null;
  const stored = await input.storage.artifacts.put(planned.manifestContent);
  if (stored.contentHash !== planned.payload.sourceManifest.contentHash)
    throw new Error("The repository change manifest differs from its stored artifact.");
  return planned;
}

/**
 * The paths a turn changed in `root`, from the snapshot prepared at its prompt to the checkout's
 * bytes now: added, removed, or rehashed files. Empty when nothing changed or the prepared
 * snapshot is gone.
 */
export async function changedTerminalPaths(
  root: string,
  contextPayload: Record<string, unknown>,
  lifecycle: TerminalLifecycleInspection,
): Promise<string[]> {
  if (!lifecycle.repositoryChange.changed || typeof contextPayload.observationId !== "string")
    return [];
  const before = await readPreparedRepositorySnapshot(root, contextPayload.observationId);
  if (before === null) return [];
  const after = await captureTerminalRepositorySnapshot(root);
  const paths = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
  return [...paths].filter((path) => before.files[path] !== after.files[path]).sort();
}

/** Appends the planned change with the observed turn's coordinates in the Stop transaction. */
export function appendTerminalRepositoryChange(
  transaction: OutboxTransaction,
  input: {
    projectId: string;
    coordinates: UnmanagedTerminalCoordinates;
    provider: TerminalIntegrationProvider;
    occurredAt: string;
    change: PlannedRepositoryChange;
    /** ADR-0605: whether this host holds knowledge jobs; the event is appended either way. */
    admission: RepositoryKnowledgeJobAdmission;
  },
): boolean {
  const {
    type: _type,
    payload: _payload,
    schemaVersion: _version,
    ...draft
  } = terminalEventDraft({
    projectId: input.projectId,
    coordinates: input.coordinates,
    provider: input.provider,
    type: "terminal.turn.observed",
    occurredAt: input.occurredAt,
    payload: {},
  });
  return appendRepositoryChange(transaction, draft, input.change, input.admission).enqueued;
}
