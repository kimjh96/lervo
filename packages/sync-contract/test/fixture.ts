import { computeEventHash, type EventHashInput } from "@lervo/event-contract";
import { defaultProjectDataPolicy, type EventEnvelope, type ProjectManifest } from "@lervo/schemas";

import { createProjectRegistrationRequest } from "../src/index.js";

export const destinationId = "hub:primary";
const policyVersion = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export function manifest(
  projectId = "prj_sync_project_01",
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

export function eventChain(
  projectId: string,
  count: number,
  override: (seq: number) => {
    schemaVersion?: 1 | 2;
    type?: EventEnvelope["type"];
    payload?: Record<string, unknown>;
  } = () => ({}),
): EventEnvelope[] {
  const events: EventEnvelope[] = [];
  let previousHash: string | null = null;
  for (let seq = 1; seq <= count; seq += 1) {
    const item = override(seq);
    const withoutHash = {
      eventId: `evt_sync_${projectId.slice(4)}_${String(seq).padStart(2, "0")}`,
      projectId,
      runId: `run_sync_${projectId.slice(4)}`,
      sessionId: `ses_sync_${projectId.slice(4)}`,
      seq,
      type: item.type ?? "run.requested",
      occurredAt: `2026-08-19T00:00:${String(seq).padStart(2, "0")}.000Z`,
      actor: { kind: "user" },
      schemaVersion: item.schemaVersion ?? 1,
      policyVersion,
      payload: item.payload ?? {
        requestDigest: `sha256:${String(seq).padStart(64, "0")}`,
        role: "developer",
        risk: "low",
      },
      previousHash,
    } as EventHashInput;
    const event = {
      ...withoutHash,
      eventHash: computeEventHash(withoutHash),
    } as EventEnvelope;
    events.push(event);
    previousHash = event.eventHash;
  }
  return events;
}

export function registration(project: ProjectManifest, requestedAt = "2026-08-19T01:00:00.000Z") {
  return createProjectRegistrationRequest({ manifest: project, destinationId, requestedAt });
}
