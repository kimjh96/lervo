import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import {
  type EventDraft,
  SQLiteEventStore,
} from "@lervo/event-store-sqlite";
import {
  defaultProjectDataPolicy,
  type OutboundEventBatch,
  type ProjectManifest,
  type ProjectRegistrationRequest,
} from "@lervo/schemas";
import {
  planOutboundEventAcceptance,
  planProjectRegistration,
  type ProjectSyncState,
} from "@lervo/sync-contract";

import {
  type AuthenticatedHubTransport,
  type HubTransportResponse,
  type SyncClock,
} from "../src/index.js";

export const destinationId = "hub:primary";
export const peerIdentityHash =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const policyVersion =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

export const manifest: ProjectManifest = {
  schemaVersion: 1,
  projectId: "prj_sync_worker_01",
  name: "sync-worker-fixture",
  root: ".",
  createdAt: "2026-08-19T00:00:00.000Z",
  dataPolicy: { ...defaultProjectDataPolicy, hubSyncEnabled: true },
};

const temporaryRoots: string[] = [];

export async function openStore(): Promise<SQLiteEventStore> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-sync-worker-"));
  temporaryRoots.push(root);
  return SQLiteEventStore.open({
    path: resolve(root, ".lervo/state/events.sqlite"),
    projectId: manifest.projectId,
  });
}

export async function removeTemporaryStores(): Promise<void> {
  await Promise.all(
    temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
}

function draft(seq: number): EventDraft {
  const occurredAt = new Date(Date.parse("2026-08-19T00:00:00.000Z") + seq * 1_000).toISOString();
  return {
    eventId: `evt_sync_worker_${String(seq).padStart(2, "0")}`,
    projectId: manifest.projectId,
    runId: "run_sync_worker_01",
    sessionId: "ses_sync_worker_01",
    type: "run.requested",
    occurredAt,
    actor: { kind: "user" },
    schemaVersion: 1,
    policyVersion,
    payload: {
      requestDigest: `sha256:${String(seq).padStart(64, "0")}`,
      role: "developer",
      risk: "low",
    },
  };
}

export function appendEvents(
  store: SQLiteEventStore,
  count: number,
  enqueuedSequences: readonly number[] = Array.from({ length: count }, (_, index) => index + 1),
): void {
  for (let seq = 1; seq <= count; seq += 1) {
    store.transact((transaction) => {
      const event = transaction.append(draft(seq)).event;
      if (enqueuedSequences.includes(seq)) {
        transaction.enqueue({
          eventId: event.eventId,
          destinationId,
          enqueuedAt: new Date(
            Date.parse("2026-08-19T00:01:00.000Z") + seq * 1_000,
          ).toISOString(),
        });
      }
    });
  }
}

export class MutableClock implements SyncClock {
  constructor(public value = "2026-08-19T02:00:00.000Z") {}

  now(): string {
    return this.value;
  }
}

export type HubFixtureMode =
  | "normal"
  | "lose_first_batch_response"
  | "wrong_batch_peer"
  | "invalid_first_ack"
  | "lose_second_batch_response"
  | "registration_unavailable";

export class HubFixtureTransport implements AuthenticatedHubTransport {
  state: ProjectSyncState | null = null;
  readonly batches: OutboundEventBatch[] = [];
  private batchCalls = 0;

  constructor(
    readonly mode: HubFixtureMode = "normal",
    private readonly acceptedAt = "2026-08-19T02:00:00.000Z",
  ) {}

  private response(body: unknown, peerHash = peerIdentityHash): HubTransportResponse {
    return {
      authentication: {
        status: "verified",
        destinationId,
        peerIdentityHash: peerHash,
      },
      body,
    };
  }

  async registerProject(request: ProjectRegistrationRequest): Promise<HubTransportResponse> {
    if (this.mode === "registration_unavailable") {
      throw new Error("fixture transport unavailable");
    }
    const planned = planProjectRegistration({
      current: this.state,
      request,
      acceptedAt: this.acceptedAt,
    });
    this.state = planned.state;
    return this.response(planned.response);
  }

  async sendEventBatch(batch: OutboundEventBatch): Promise<HubTransportResponse> {
    if (this.state === null) throw new Error("fixture registration missing");
    this.batchCalls += 1;
    this.batches.push(structuredClone(batch));
    const planned = planOutboundEventAcceptance({
      state: this.state,
      batch,
      acknowledgedAt: this.acceptedAt,
    });
    this.state = planned.state;
    if (this.mode === "lose_first_batch_response" && this.batchCalls === 1) {
      throw new Error("fixture response lost after durable commit");
    }
    if (this.mode === "lose_second_batch_response" && this.batchCalls === 2) {
      throw new Error("fixture second response lost after durable commit");
    }
    if (this.mode === "wrong_batch_peer") {
      return this.response(
        planned.acknowledgement,
        "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      );
    }
    if (this.mode === "invalid_first_ack" && this.batchCalls === 1) {
      return this.response({
        ...planned.acknowledgement,
        acceptedEventIds: ["evt_wrong_ack_01"],
      });
    }
    return this.response(planned.acknowledgement);
  }
}
