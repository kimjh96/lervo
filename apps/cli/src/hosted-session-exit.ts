// The session host's report of a hosted session's process exit (`session.exited`). It covers the
// ends the provider's `SessionEnd` hook cannot record, such as a crash or a killed process.
import { hostedSessionEventSchemaVersion } from "@lervo/event-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import { hostedLaunchRecordsPath, latestHostedLaunchOfSession } from "./hosted-launch-records.js";
import {
  appendHostedSessionEvents,
  endedEvent,
  hostedSessionRunId,
  providerSessionDigest,
  type HostedSessionEventOutcome,
  type HostedSessionEventStore,
} from "./hosted-session-events.js";
import type { HostedLaunchRecord } from "./hosted-launch-records.js";

/** What the report did: `skipped` when the hook already recorded this launch's end. */
export type HostedSessionExitOutcome = HostedSessionEventOutcome | "skipped" | "unknown_session";

/** Whether an end of `record`'s launch is already recorded, by its hook or an earlier report. */
export function launchEndRecorded(
  store: HostedSessionEventStore,
  record: HostedLaunchRecord,
): boolean {
  const digest = providerSessionDigest(record.provider, record.sessionId);
  return store.events
    .list({ runId: hostedSessionRunId(record.workspaceId), types: ["terminal.session.ended"] })
    .some(
      (event) =>
        event.payload.providerSessionDigest === digest && event.occurredAt >= record.preparedAt,
    );
}

/** Records `process_exited` for `record` unless its launch's end is already recorded. */
export function appendProcessExit(
  store: HostedSessionEventStore,
  record: HostedLaunchRecord,
  exitCode: number | null,
  occurredAt: string,
): HostedSessionExitOutcome {
  if ((store.writableEventSchemaVersion ?? 1) < hostedSessionEventSchemaVersion) return "inactive";
  if (launchEndRecorded(store, record)) return "skipped";
  return appendHostedSessionEvents(store, [
    endedEvent(record, occurredAt, "process_exited", exitCode),
  ]);
}

/** Answers `session.exited` for the newest launch of `sessionId`. */
export async function recordHostedSessionExit(
  sessionId: string,
  exitCode: number | null,
  now: () => Date = () => new Date(),
): Promise<{ status: HostedSessionExitOutcome }> {
  const record = await latestHostedLaunchOfSession(hostedLaunchRecordsPath(), sessionId);
  if (record === null) return { status: "unknown_session" };
  const repository = await resolveRegisteredRepository({
    registryPath: defaultRepositoryRegistryPath(),
    projectId: record.projectId,
  });
  const storage = await openProjectStorage(repository.repositoryRoot);
  try {
    return { status: appendProcessExit(storage, record, exitCode, now().toISOString()) };
  } finally {
    await storage.close();
  }
}
