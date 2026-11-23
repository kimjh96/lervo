// The ADE's hosted session events (schema 10, ADR-0613): built here and recorded in the
// registered repository's store, never in a workspace's worktree, which has no writer of its own.
import { createHash } from "node:crypto";

import { hostedSessionEventSchemaVersion, type EventDraftV10 } from "@lervo/event-contract";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import type { HostedConversationMode } from "@lervo/adapter-contract";

import type { HostedLaunchRecord } from "./hosted-launch-records.js";

type HostedSessionEventType = Extract<
  EventDraftV10["type"],
  | "application.workspace.started"
  | "terminal.session.launch_prepared"
  | "terminal.session.launched"
  | "terminal.session.ended"
>;

/** One hosted session event before Lervo gives it an envelope. */
export interface HostedSessionEvent {
  readonly type: HostedSessionEventType;
  readonly occurredAt: string;
  /** Groups a workspace's events; the envelope's run ID derives from it. */
  readonly workspaceId: string;
  readonly payload: Readonly<Record<string, string | number | null>>;
}

/**
 * Whether the events were recorded. `inactive` means the repository's writer selects a schema
 * below 10, so Lervo records none of them and the launch goes on (`hosted_events_inactive`).
 */
export type HostedSessionEventOutcome = "recorded" | "inactive";

const POLICY_VERSION = sha256("lervo.hosted-session-events.v1");

export function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

/**
 * The digest that names a hosted session in every event; the UUID stays on the host. It is the
 * digest terminal turn events use, so a hosted session's turns and its launch join.
 */
export function providerSessionDigest(provider: string, sessionId: string): string {
  return sha256(`${provider}\0${sessionId}`);
}

function suffix(digest: string): string {
  return digest.slice("sha256:".length, "sha256:".length + 24);
}

/** The envelope run ID that groups one workspace's hosted session events. */
export function hostedSessionRunId(workspaceId: string): string {
  return `run_hosted_${suffix(sha256(workspaceId))}`;
}

/** The digest of a launch descriptor record, which `launch_prepared` and `launched` share. */
export function launchDescriptorDigest(record: HostedLaunchRecord): string {
  return sha256(JSON.stringify(record));
}

export function workspaceStartedEvent(input: {
  record: HostedLaunchRecord;
  workstreamId: string;
  instruction: string;
}): HostedSessionEvent {
  return {
    type: "application.workspace.started",
    occurredAt: input.record.preparedAt,
    workspaceId: input.record.workspaceId,
    payload: {
      workspaceId: input.record.workspaceId,
      workstreamId: input.workstreamId,
      branch: input.record.branch,
      providerSessionDigest: providerSessionDigest(input.record.provider, input.record.sessionId),
      instructionDigest: sha256(input.instruction),
      startedAt: input.record.preparedAt,
    },
  };
}

export function launchPreparedEvent(record: HostedLaunchRecord): HostedSessionEvent {
  const mode: HostedConversationMode = record.conversationMode;
  return {
    type: "terminal.session.launch_prepared",
    occurredAt: record.preparedAt,
    workspaceId: record.workspaceId,
    payload: {
      providerSessionDigest: providerSessionDigest(record.provider, record.sessionId),
      provider: record.provider,
      workspaceId: record.workspaceId,
      conversationMode: mode,
      descriptorDigest: launchDescriptorDigest(record),
    },
  };
}

export function launchedEvent(record: HostedLaunchRecord, occurredAt: string): HostedSessionEvent {
  return {
    type: "terminal.session.launched",
    occurredAt,
    workspaceId: record.workspaceId,
    payload: {
      providerSessionDigest: providerSessionDigest(record.provider, record.sessionId),
      provider: record.provider,
      descriptorDigest: launchDescriptorDigest(record),
    },
  };
}

export type HostedSessionEndReason =
  "clear" | "logout" | "prompt_input_exit" | "other" | "process_exited";

export function endedEvent(
  record: HostedLaunchRecord,
  occurredAt: string,
  endReason: HostedSessionEndReason,
  exitCode: number | null,
): HostedSessionEvent {
  return {
    type: "terminal.session.ended",
    occurredAt,
    workspaceId: record.workspaceId,
    payload: {
      providerSessionDigest: providerSessionDigest(record.provider, record.sessionId),
      endReason,
      exitCode,
    },
  };
}

/** The parts of a repository's storage that recording needs. */
export type HostedSessionEventStore = Pick<
  ProjectStorage,
  "manifest" | "events" | "writableEventSchemaVersion"
>;

/**
 * Appends `events` to `storage`, or nothing when its writer selects a schema below 10. Each
 * event's ID derives from its type, time, and payload, so recording the same event again changes
 * nothing, while a resumed session, which keeps its session ID, still records each end.
 */
export function appendHostedSessionEvents(
  storage: HostedSessionEventStore,
  events: readonly HostedSessionEvent[],
): HostedSessionEventOutcome {
  if ((storage.writableEventSchemaVersion ?? 1) < hostedSessionEventSchemaVersion)
    return "inactive";
  for (const event of events) {
    const id = sha256(JSON.stringify([event.type, event.occurredAt, event.payload])).slice(7, 39);
    const eventId = `evt_${id}`;
    if (storage.events.get(eventId)) continue;
    storage.events.append({
      eventId,
      projectId: storage.manifest.projectId,
      runId: hostedSessionRunId(event.workspaceId),
      sessionId: `ses_hosted_${suffix(String(event.payload.providerSessionDigest))}`,
      type: event.type,
      schemaVersion: hostedSessionEventSchemaVersion,
      occurredAt: event.occurredAt,
      actor: { kind: "system" },
      policyVersion: POLICY_VERSION,
      payload: { ...event.payload },
    });
  }
  return "recorded";
}

/** Records `events` in the registered repository at `repositoryRoot`. */
export async function recordHostedSessionEvents(
  repositoryRoot: string,
  events: readonly HostedSessionEvent[],
): Promise<HostedSessionEventOutcome> {
  const storage = await openProjectStorage(repositoryRoot);
  try {
    return appendHostedSessionEvents(storage, events);
  } finally {
    await storage.close();
  }
}
