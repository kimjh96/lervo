import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { SQLiteEventStore } from "@lervo/event-store-sqlite";
import { computeEventHash, eventWithoutHash } from "@lervo/event-contract";
import { afterEach, expect, it, vi } from "vitest";
import { watchLocalEventChanges } from "../src/local-event-wakeup.js";
import {
  nodeRuntimeFixture,
  nodeRuntimeProjectId,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

afterEach(removeTemporaryRoots);
it("observes a WAL commit from another process, ignores unchanged heads, and closes the watcher", async () => {
  const f = await nodeRuntimeFixture(await temporaryRoot(), 1);
  const store = await SQLiteEventStore.open({
    path: f.databasePath,
    projectId: nodeRuntimeProjectId,
  });
  const notify = vi.fn();
  const close = watchLocalEventChanges(store, notify);
  try {
    const previous = store.latest()!;
    const event = {
      ...previous,
      eventId: "evt_cross_process_01",
      seq: previous.seq + 1,
      previousHash: previous.eventHash,
    };
    event.eventHash = computeEventHash(eventWithoutHash(event));
    await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      `
      import { DatabaseSync } from "node:sqlite";
      const db = new DatabaseSync(process.argv[1]);
      const event = JSON.parse(process.argv[2]);
      db.prepare('INSERT INTO events (event_id, project_id, seq, run_id, session_id, type, occurred_at, actor_json, schema_version, policy_version, payload_json, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(event.eventId, event.projectId, event.seq, event.runId, event.sessionId, event.type, event.occurredAt, JSON.stringify(event.actor), event.schemaVersion, event.policyVersion, JSON.stringify(event.payload), event.previousHash, event.eventHash);
      db.close();
    `,
      f.databasePath,
      JSON.stringify(event),
    ]);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(store.latest()?.eventHash).toBe(event.eventHash);
    store.enqueue({
      eventId: event.eventId,
      destinationId: "hub:other",
      enqueuedAt: event.occurredAt,
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(notify).toHaveBeenCalledTimes(1);
  } finally {
    close();
    store.close();
  }
});
