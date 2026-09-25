import { captureRepositorySnapshot } from "@lervo/orchestrator";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  appendRepositoryChange,
  planRepositoryChangeInRepository,
  type PlannedRepositoryChange,
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
  storage: Pick<ProjectStorage, "writableEventSchemaVersion" | "artifacts">;
  contextPayload: Record<string, unknown>;
  lifecycle: TerminalLifecycleInspection;
  turnEventId: string;
  occurredAt: string;
}): Promise<PlannedRepositoryChange | null> {
  if (!input.lifecycle.repositoryChange.changed || input.storage.writableEventSchemaVersion !== 3)
    return null;
  if (typeof input.contextPayload.observationId !== "string") return null;
  const before = await readPreparedRepositorySnapshot(
    input.root,
    input.contextPayload.observationId,
  );
  if (before === null || before.revision !== input.lifecycle.repositoryChange.beforeRevision)
    return null;
  const after = await captureRepositorySnapshot(input.root);
  // A change after lifecycle inspection belongs to the next observed turn.
  if (after.revision !== input.lifecycle.repositoryChange.afterRevision) return null;
  const planned = await planRepositoryChangeInRepository({
    repositoryRoot: input.root,
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

/** Appends the planned change with the observed turn's coordinates in the Stop transaction. */
export function appendTerminalRepositoryChange(
  transaction: OutboxTransaction,
  input: {
    projectId: string;
    coordinates: UnmanagedTerminalCoordinates;
    provider: TerminalIntegrationProvider;
    occurredAt: string;
    change: PlannedRepositoryChange;
  },
): void {
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
  appendRepositoryChange(transaction, draft, input.change);
}
