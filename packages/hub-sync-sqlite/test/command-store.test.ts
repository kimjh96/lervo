import { DatabaseSync } from "node:sqlite";

import {
  handleOutboundEventBatch,
  handleProjectRegistration,
} from "@lervo/hub-sync";
import {
  planOutboundEventAcceptance,
  planProjectRegistration,
  type ProjectSyncState,
} from "@lervo/sync-contract";
import { afterEach, describe, expect, it } from "vitest";

import { HubSyncSQLiteStore } from "../src/index.js";
import {
  acceptEvents,
  batch,
  databasePath,
  eventChain,
  manifest,
  registerStore,
  registration,
  removeTemporaryRoots,
} from "./fixture.js";

const acceptedAt = "2026-08-19T02:00:00.000Z";

afterEach(removeTemporaryRoots);

describe("Hub sync SQLite command store", () => {
  it("commits registration before resolving and recovers it after restart", async () => {
    const path = await databasePath();
    const project = manifest();
    const first = await HubSyncSQLiteStore.open({ path });
    await expect(registerStore(first, project)).resolves.toMatchObject({
      status: "registered",
      cursor: { seq: 0, eventHash: null },
    });
    await expect(first.journalMode()).resolves.toBe("wal");
    await first.close();

    const reopened = await HubSyncSQLiteStore.open({ path });
    await expect(registerStore(reopened, project, "2026-08-19T03:00:00.000Z"))
      .resolves.toMatchObject({ status: "unchanged" });
    await expect(registerStore(
      reopened,
      manifest(project.projectId, { name: "renamed-project" }),
      "2026-08-19T04:00:00.000Z",
    )).resolves.toMatchObject({ status: "updated" });
    await reopened.close();
  });

  it("durably buffers an out-of-order batch and advances only after the gap arrives", async () => {
    const path = await databasePath();
    const project = manifest();
    const events = eventChain(project.projectId, 4);
    const first = await HubSyncSQLiteStore.open({ path });
    await registerStore(first, project);
    await expect(acceptEvents(first, project, events.slice(2))).resolves.toMatchObject({
      insertedCount: 2,
      cursor: { seq: 0, eventHash: null },
      bufferedEventCount: 2,
    });
    await first.close();

    const reopened = await HubSyncSQLiteStore.open({ path });
    await expect(acceptEvents(reopened, project, events.slice(0, 2))).resolves.toMatchObject({
      cursor: { seq: 4, eventHash: events[3]!.eventHash },
      bufferedEventCount: 0,
    });
    await expect(reopened.auditIntegrity()).resolves.toEqual({
      valid: true,
      projectCount: 1,
      eventCount: 4,
    });
    await reopened.close();
  });

  it("returns duplicate after a committed response was lost", async () => {
    const path = await databasePath();
    const project = manifest();
    const events = eventChain(project.projectId, 2);
    const first = await HubSyncSQLiteStore.open({ path });
    await registerStore(first, project);
    await expect(acceptEvents(first, project, events)).resolves.toMatchObject({
      status: "accepted",
      insertedCount: 2,
    });
    await first.close();

    const reopened = await HubSyncSQLiteStore.open({ path });
    await expect(acceptEvents(reopened, project, events)).resolves.toMatchObject({
      status: "duplicate",
      insertedCount: 0,
      duplicateCount: 2,
      cursor: { seq: 2 },
    });
    await reopened.close();
  });

  it("matches the pure reference contract while using incremental storage", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest("prj_hub_contract_01");
    const request = registration(project);
    const registered = planProjectRegistration({ current: null, request, acceptedAt });
    let reference: ProjectSyncState = registered.state;
    await expect(handleProjectRegistration({ store, request, acceptedAt }))
      .resolves.toEqual(registered.response);

    const events = eventChain(project.projectId, 4);
    for (const selected of [events.slice(2), events.slice(0, 2), events.slice(2)]) {
      const outbound = batch(project, selected);
      const planned = planOutboundEventAcceptance({
        state: reference,
        batch: outbound,
        acknowledgedAt: acceptedAt,
      });
      reference = planned.state;
      await expect(handleOutboundEventBatch({ store, batch: outbound, acknowledgedAt: acceptedAt }))
        .resolves.toEqual(planned.acknowledgement);
    }
    await store.close();
  });

  it("rolls back new events when the cursor update cannot commit", async () => {
    const path = await databasePath();
    const project = manifest();
    const events = eventChain(project.projectId, 2);
    const store = await HubSyncSQLiteStore.open({ path });
    await registerStore(store, project);
    const fault = new DatabaseSync(path);
    fault.exec(`
      CREATE TRIGGER fixture_fail_cursor BEFORE UPDATE ON hub_projects
      BEGIN SELECT RAISE(ABORT, 'fixture cursor failure'); END;
    `);
    fault.close();

    await expect(acceptEvents(store, project, events)).rejects.toMatchObject({ code: "write_failed" });
    await expect(store.checkIntegrity()).resolves.toMatchObject({ eventCount: 0 });
    const recovery = new DatabaseSync(path);
    recovery.exec("DROP TRIGGER fixture_fail_cursor;");
    recovery.close();
    await expect(acceptEvents(store, project, events)).resolves.toMatchObject({ insertedCount: 2 });
    await store.close();
  });

  it("rejects identity conflicts and batches without registration", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest();
    await registerStore(store, project);
    await expect(registerStore(store, manifest(project.projectId, {
      createdAt: "2026-08-20T00:00:00.000Z",
    }))).rejects.toMatchObject({ code: "registration_identity_conflict" });
    const missing = manifest("prj_hub_missing_01");
    await expect(acceptEvents(store, missing, eventChain(missing.projectId, 1)))
      .rejects.toMatchObject({ code: "registration_required" });
    await store.close();
  });
});
