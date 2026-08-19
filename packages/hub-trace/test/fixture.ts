import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { computeEventHash } from "@lervo/event-contract";
import {
  defaultProjectDataPolicy,
  type EventEnvelope,
  type EventType,
  type ProjectManifest,
} from "@lervo/schemas";
import {
  createOutboundEventBatch,
  createProjectRegistrationRequest,
} from "@lervo/sync-contract";

export const destinationId = "hub:primary";
const policyVersion =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const temporaryRoots: string[] = [];

export function manifest(projectId: string): ProjectManifest {
  return {
    schemaVersion: 1,
    projectId,
    name: `name-${projectId}`,
    root: ".",
    createdAt: "2026-08-19T00:00:00.000Z",
    dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
  };
}

export async function databasePath(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-hub-trace-"));
  temporaryRoots.push(root);
  return resolve(root, "state/hub-sync.sqlite");
}

export async function removeTemporaryRoots(): Promise<void> {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

export function registration(project: ProjectManifest) {
  return createProjectRegistrationRequest({
    manifest: project,
    destinationId,
    requestedAt: "2026-08-19T01:00:00.000Z",
  });
}

export function eventChain(
  projectId: string,
  runs: readonly {
    runId: string;
    sessionId?: string;
    type?: EventType;
    payload?: Record<string, unknown>;
  }[],
): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  let previousHash: string | null = null;
  for (const [index, run] of runs.entries()) {
    const seq = index + 1;
    const withoutHash: Omit<EventEnvelope, "eventHash"> = {
      eventId: `evt_trace_${projectId.slice(4)}_${String(seq).padStart(2, "0")}`,
      projectId,
      runId: run.runId,
      sessionId: run.sessionId ?? `ses_trace_${run.runId.slice(4)}`,
      seq,
      type: run.type ?? "run.requested",
      occurredAt: `2026-08-19T00:00:${String(seq).padStart(2, "0")}.000Z`,
      actor: { kind: "user" },
      schemaVersion: 1,
      policyVersion,
      payload: run.payload ?? {
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
  return createOutboundEventBatch({ registration: registration(project), events });
}
