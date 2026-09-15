import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

it("reads a commit written to the shared database by another process", async () => {
  const f = await nodeRuntimeFixture(await temporaryRoot(), 1);
  const store = await SQLiteEventStore.open({
    path: f.databasePath,
    projectId: nodeRuntimeProjectId,
  });
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
    expect(store.latest()?.eventHash).toBe(event.eventHash);
    // Queueing for a destination is not a new head, so it cannot be mistaken for fresh work.
    store.enqueue({
      eventId: event.eventId,
      destinationId: "hub:other",
      enqueuedAt: event.occurredAt,
    });
    expect(store.latest()?.eventHash).toBe(event.eventHash);
  } finally {
    store.close();
  }
});

it("notifies once per observed head change and stops once closed", async () => {
  // A WAL append is a content-only change that need not surface as a directory entry at all, so
  // the guaranteed contract is the head comparison. Drive it from a notification we control.
  const directory = await mkdtemp(join(tmpdir(), "lervo-wakeup-"));
  const path = join(directory, "events.sqlite");
  let head = "sha256:first";
  const notify = vi.fn();
  const close = watchLocalEventChanges(
    { path, latest: () => ({ eventHash: head }) } as unknown as Parameters<
      typeof watchLocalEventChanges
    >[0],
    notify,
  );
  try {
    head = "sha256:second";
    await vi.waitFor(
      async () => {
        await writeFile(path, `${Date.now()}`);
        expect(notify).toHaveBeenCalledTimes(1);
      },
      { timeout: 10_000 },
    );
    // An unchanged head never notifies, however many notifications the host delivers.
    await writeFile(path, "unchanged-head");
    await writeFile(path, "unchanged-head-again");
    expect(notify).toHaveBeenCalledTimes(1);
    close();
    head = "sha256:third";
    await writeFile(path, "after-close");
    expect(notify).toHaveBeenCalledTimes(1);
  } finally {
    close();
    await rm(directory, { recursive: true, force: true });
  }
});
