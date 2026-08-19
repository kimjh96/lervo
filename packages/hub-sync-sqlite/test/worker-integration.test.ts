import {
  type EventDraft,
  SQLiteEventStore,
} from "@lervo/event-store-sqlite";
import {
  handleOutboundEventBatch,
  handleProjectRegistration,
} from "@lervo/hub-sync";
import {
  type OutboundEventBatch,
  type ProjectRegistrationRequest,
} from "@lervo/schemas";
import {
  type AuthenticatedHubTransport,
  runOutboundSyncCycle,
  type SyncClock,
} from "@lervo/sync";
import { afterEach, describe, expect, it } from "vitest";

import { HubSyncSQLiteStore } from "../src/index.js";
import {
  databasePath,
  destinationId,
  manifest,
  removeTemporaryRoots,
} from "./fixture.js";

const peerIdentityHash =
  "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const policyVersion =
  "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

class MutableClock implements SyncClock {
  constructor(public value = "2026-08-19T02:00:00.000Z") {}

  now(): string {
    return this.value;
  }
}

class DirectHubTransport implements AuthenticatedHubTransport {
  private batchCalls = 0;

  constructor(private readonly hub: HubSyncSQLiteStore) {}

  private response(body: unknown) {
    return {
      authentication: {
        status: "verified" as const,
        destinationId,
        peerIdentityHash,
      },
      body,
    };
  }

  async registerProject(request: ProjectRegistrationRequest): Promise<unknown> {
    return this.response(handleProjectRegistration({
      store: this.hub,
      request,
      acceptedAt: request.requestedAt,
    }));
  }

  async sendEventBatch(batch: OutboundEventBatch): Promise<unknown> {
    this.batchCalls += 1;
    const acknowledgement = handleOutboundEventBatch({
      store: this.hub,
      batch,
      acknowledgedAt: "2026-08-19T02:00:00.000Z",
    });
    if (this.batchCalls === 1) {
      throw new Error("fixture response lost after Hub commit");
    }
    return this.response(acknowledgement);
  }
}

function draft(seq: number, projectId: string): EventDraft {
  return {
    eventId: `evt_full_sync_${String(seq).padStart(2, "0")}`,
    projectId,
    runId: "run_full_sync_01",
    sessionId: "ses_full_sync_01",
    type: "run.requested",
    occurredAt: `2026-08-19T00:00:${String(seq).padStart(2, "0")}.000Z`,
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

afterEach(removeTemporaryRoots);

describe("Node worker to durable Hub integration", () => {
  it("recovers a lost response through the actual local and Hub SQLite stores", async () => {
    const project = manifest("prj_full_sync_01");
    const local = await SQLiteEventStore.open({
      path: await databasePath(),
      projectId: project.projectId,
    });
    for (let seq = 1; seq <= 2; seq += 1) {
      local.transact((transaction) => {
        const event = transaction.append(draft(seq, project.projectId)).event;
        transaction.enqueue({
          eventId: event.eventId,
          destinationId,
          enqueuedAt: `2026-08-19T00:01:${String(seq).padStart(2, "0")}.000Z`,
        });
      });
    }
    const hub = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const transport = new DirectHubTransport(hub);
    const clock = new MutableClock();
    const options = {
      store: local,
      transport,
      manifest: project,
      destinationId,
      expectedPeerIdentityHash: peerIdentityHash,
      workerId: "full-sync-worker",
      clock,
      retryDelayMs: 5_000,
    };

    await expect(runOutboundSyncCycle(options)).resolves.toMatchObject({
      status: "retry_scheduled",
      failureCode: "hub_unavailable",
      acknowledgedCount: 0,
      rescheduledCount: 2,
    });
    expect(hub.getProject({ destinationId, projectId: project.projectId })).toMatchObject({
      cursor: { seq: 2 },
      events: [{ seq: 1 }, { seq: 2 }],
    });
    expect(local.listOutbox({ status: "pending" })).toHaveLength(2);

    clock.value = "2026-08-19T02:00:05.000Z";
    await expect(runOutboundSyncCycle(options)).resolves.toMatchObject({
      status: "synchronized",
      acknowledgedCount: 2,
      cursor: { seq: 2 },
    });
    expect(local.listOutbox({ status: "acknowledged" })).toHaveLength(2);
    expect(hub.verifyIntegrity()).toEqual({ valid: true, projectCount: 1, eventCount: 2 });
    expect(local.list()).toHaveLength(2);
    local.close();
    hub.close();
  });
});
