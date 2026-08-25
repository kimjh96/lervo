import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { computeEventHash } from "@lervo/event-contract";
import {
  handleOutboundEventBatch,
  handleProjectRegistration,
  type HubSyncCommandStore,
} from "@lervo/hub-sync";
import {
  defaultProjectDataPolicy,
  type EventEnvelope,
  type EventType,
  type ProjectManifest,
} from "@lervo/schemas";
import { createOutboundEventBatch, createProjectRegistrationRequest } from "@lervo/sync-contract";

export const destinationId = "hub:primary";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const temporaryRoots: string[] = [];

export function manifest(
  projectId = "prj_hub_sync_01",
  overrides: Partial<ProjectManifest> = {},
): ProjectManifest {
  return {
    schemaVersion: 1,
    projectId,
    name: projectId,
    root: ".",
    createdAt: "2026-08-19T00:00:00.000Z",
    dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
    ...overrides,
  };
}

export async function databasePath(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-hub-sync-"));
  temporaryRoots.push(root);
  return resolve(root, "state/hub-sync.sqlite");
}

export async function removeTemporaryRoots(): Promise<void> {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

export function registration(project: ProjectManifest, requestedAt = "2026-08-19T01:00:00.000Z") {
  return createProjectRegistrationRequest({
    manifest: project,
    destinationId,
    requestedAt,
  });
}

export function eventChain(
  projectId: string,
  count: number,
  override: (seq: number) => {
    runId?: string;
    sessionId?: string;
    type?: EventType;
    payload?: Record<string, unknown>;
    actor?: EventEnvelope["actor"];
  } = () => ({}),
): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  let previousHash: string | null = null;
  for (let seq = 1; seq <= count; seq += 1) {
    const item = override(seq);
    const withoutHash: Omit<EventEnvelope, "eventHash"> = {
      eventId: `evt_hub_${projectId.slice(4)}_${String(seq).padStart(2, "0")}`,
      projectId,
      runId: item.runId ?? `run_hub_${projectId.slice(4)}`,
      sessionId: item.sessionId ?? `ses_hub_${projectId.slice(4)}`,
      seq,
      type: item.type ?? "run.requested",
      occurredAt: `2026-08-19T00:00:${String(seq).padStart(2, "0")}.000Z`,
      actor: item.actor ?? { kind: "user" },
      schemaVersion: 1,
      policyVersion,
      payload: item.payload ?? {
        requestDigest: `sha256:${String(seq).padStart(64, "0")}`,
        role: "developer",
        risk: "low",
      },
      previousHash,
    };
    const event = { ...withoutHash, eventHash: computeEventHash(withoutHash) };
    events.push(event);
    previousHash = event.eventHash;
  }
  return events;
}

export function batch(project: ProjectManifest, events: readonly EventEnvelope[]) {
  return createOutboundEventBatch({
    registration: registration(project),
    events,
  });
}

export async function registerStore(
  store: HubSyncCommandStore,
  project: ProjectManifest,
  acceptedAt = "2026-08-19T02:00:00.000Z",
) {
  return handleProjectRegistration({
    store,
    request: registration(project, acceptedAt),
    acceptedAt,
  });
}

export async function acceptEvents(
  store: HubSyncCommandStore,
  project: ProjectManifest,
  events: readonly EventEnvelope[],
  acknowledgedAt = "2026-08-19T02:00:00.000Z",
) {
  return handleOutboundEventBatch({
    store,
    batch: batch(project, events),
    acknowledgedAt,
  });
}
