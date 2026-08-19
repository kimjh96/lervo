import { DatabaseSync } from "node:sqlite";

import {
  handleOutboundEventBatch,
  handleProjectRegistration,
} from "@lervo/hub-sync";
import { afterEach, describe, expect, it } from "vitest";

import { HubSyncSQLiteStore } from "../src/index.js";
import {
  batch,
  databasePath,
  destinationId,
  eventChain,
  manifest,
  registration,
  removeTemporaryRoots,
} from "./fixture.js";

const acceptedAt = "2026-08-19T02:00:00.000Z";

afterEach(removeTemporaryRoots);

describe("Hub sync SQLite adapter", () => {
  it("persists registration before returning and recovers it after restart", async () => {
    const path = await databasePath();
    const project = manifest();
    const request = registration(project);
    const first = await HubSyncSQLiteStore.open({ path });

    const response = handleProjectRegistration({ store: first, request, acceptedAt });

    expect(response).toMatchObject({
      status: "registered",
      registrationId: request.registrationId,
      cursor: { seq: 0, eventHash: null },
    });
    expect(first.verifyIntegrity()).toEqual({ valid: true, projectCount: 1, eventCount: 0 });
    expect(first.journalMode()).toBe("wal");
    first.close();

    const reopened = await HubSyncSQLiteStore.open({ path });
    expect(reopened.getProject({ destinationId, projectId: project.projectId })).toMatchObject({
      registration: { request, registeredAt: acceptedAt, updatedAt: acceptedAt },
      cursor: { seq: 0, eventHash: null },
      events: [],
    });
    const unchanged = handleProjectRegistration({
      store: reopened,
      request: registration(project, "2026-08-19T03:00:00.000Z"),
      acceptedAt: "2026-08-19T03:00:00.000Z",
    });
    expect(unchanged.status).toBe("unchanged");

    const updatedProject = manifest(project.projectId, { name: "renamed-project" });
    const updated = handleProjectRegistration({
      store: reopened,
      request: registration(updatedProject, "2026-08-19T04:00:00.000Z"),
      acceptedAt: "2026-08-19T04:00:00.000Z",
    });
    expect(updated.status).toBe("updated");
    expect(reopened.getProject({ destinationId, projectId: project.projectId }))
      .toMatchObject({ registration: { request: { project: { name: "renamed-project" } } } });
    reopened.close();
  });

  it("keeps two projects isolated under the same destination", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const projects = [manifest("prj_hub_sync_01"), manifest("prj_hub_sync_02")];
    for (const project of projects) {
      handleProjectRegistration({ store, request: registration(project), acceptedAt });
      handleOutboundEventBatch({
        store,
        batch: batch(project, eventChain(project.projectId, 1)),
        acknowledgedAt: acceptedAt,
      });
    }

    expect(store.listProjectCoordinates()).toEqual([
      { destinationId, projectId: "prj_hub_sync_01" },
      { destinationId, projectId: "prj_hub_sync_02" },
    ]);
    expect(store.getProject({ destinationId, projectId: projects[0]!.projectId })?.events[0])
      .toMatchObject({ projectId: projects[0]!.projectId, seq: 1 });
    expect(store.getProject({ destinationId, projectId: projects[1]!.projectId })?.events[0])
      .toMatchObject({ projectId: projects[1]!.projectId, seq: 1 });
    expect(store.verifyIntegrity()).toEqual({ valid: true, projectCount: 2, eventCount: 2 });
    store.close();
  });

  it("durably buffers an out-of-order batch and advances only after the gap arrives", async () => {
    const path = await databasePath();
    const project = manifest();
    const events = eventChain(project.projectId, 4);
    const first = await HubSyncSQLiteStore.open({ path });
    handleProjectRegistration({ store: first, request: registration(project), acceptedAt });

    const later = handleOutboundEventBatch({
      store: first,
      batch: batch(project, events.slice(2)),
      acknowledgedAt: acceptedAt,
    });
    expect(later).toMatchObject({
      status: "accepted",
      insertedCount: 2,
      cursor: { seq: 0, eventHash: null },
      bufferedEventCount: 2,
    });
    first.close();

    const reopened = await HubSyncSQLiteStore.open({ path });
    expect(reopened.getProject({ destinationId, projectId: project.projectId })).toMatchObject({
      cursor: { seq: 0, eventHash: null },
      events: [{ seq: 3 }, { seq: 4 }],
    });
    const earlier = handleOutboundEventBatch({
      store: reopened,
      batch: batch(project, events.slice(0, 2)),
      acknowledgedAt: "2026-08-19T03:00:00.000Z",
    });
    expect(earlier).toMatchObject({
      status: "accepted",
      insertedCount: 2,
      cursor: { seq: 4, eventHash: events[3]!.eventHash },
      bufferedEventCount: 0,
    });
    expect(reopened.verifyIntegrity()).toEqual({ valid: true, projectCount: 1, eventCount: 4 });
    reopened.close();
  });

  it("returns a duplicate acknowledgement after a committed response was lost", async () => {
    const path = await databasePath();
    const project = manifest();
    const outbound = batch(project, eventChain(project.projectId, 2));
    const first = await HubSyncSQLiteStore.open({ path });
    handleProjectRegistration({ store: first, request: registration(project), acceptedAt });
    const accepted = handleOutboundEventBatch({
      store: first,
      batch: outbound,
      acknowledgedAt: acceptedAt,
    });
    expect(accepted).toMatchObject({ status: "accepted", insertedCount: 2, duplicateCount: 0 });
    first.close();

    const reopened = await HubSyncSQLiteStore.open({ path });
    const duplicate = handleOutboundEventBatch({
      store: reopened,
      batch: outbound,
      acknowledgedAt: "2026-08-19T03:00:00.000Z",
    });
    expect(duplicate).toMatchObject({
      status: "duplicate",
      insertedCount: 0,
      duplicateCount: 2,
      acceptedEventIds: outbound.events.map((event) => event.eventId),
      cursor: { seq: 2 },
    });
    expect(reopened.verifyIntegrity()).toEqual({ valid: true, projectCount: 1, eventCount: 2 });
    reopened.close();
  });

  it("rolls back inserted events when the cursor update cannot commit", async () => {
    const path = await databasePath();
    const project = manifest();
    const outbound = batch(project, eventChain(project.projectId, 2));
    const store = await HubSyncSQLiteStore.open({ path });
    handleProjectRegistration({ store, request: registration(project), acceptedAt });
    const fault = new DatabaseSync(path);
    fault.exec(`
      CREATE TRIGGER fixture_fail_cursor BEFORE UPDATE ON hub_projects
      BEGIN SELECT RAISE(ABORT, 'fixture cursor failure'); END;
    `);
    fault.close();

    expect(() => handleOutboundEventBatch({
      store,
      batch: outbound,
      acknowledgedAt: acceptedAt,
    })).toThrowError(expect.objectContaining({ code: "write_failed" }));
    expect(store.getProject({ destinationId, projectId: project.projectId })).toMatchObject({
      cursor: { seq: 0, eventHash: null },
      events: [],
    });

    const recovery = new DatabaseSync(path);
    recovery.exec("DROP TRIGGER fixture_fail_cursor;");
    recovery.close();
    const accepted = handleOutboundEventBatch({
      store,
      batch: outbound,
      acknowledgedAt: "2026-08-19T03:00:00.000Z",
    });
    expect(accepted).toMatchObject({ status: "accepted", insertedCount: 2, duplicateCount: 0 });
    store.close();
  });

  it("rejects a different identity at the same destination and project coordinate", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest();
    handleProjectRegistration({ store, request: registration(project), acceptedAt });

    expect(() => handleProjectRegistration({
      store,
      request: registration(manifest(project.projectId, {
        createdAt: "2026-08-20T00:00:00.000Z",
      })),
      acceptedAt: "2026-08-20T01:00:00.000Z",
    })).toThrowError(expect.objectContaining({ code: "registration_identity_conflict" }));
    expect(store.verifyIntegrity()).toEqual({ valid: true, projectCount: 1, eventCount: 0 });
    store.close();
  });

  it("does not create an inbox when an event batch has no registration", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest();

    expect(() => handleOutboundEventBatch({
      store,
      batch: batch(project, eventChain(project.projectId, 1)),
      acknowledgedAt: acceptedAt,
    })).toThrowError(expect.objectContaining({ code: "registration_required" }));
    expect(store.verifyIntegrity()).toEqual({ valid: true, projectCount: 0, eventCount: 0 });
    store.close();
  });

  it("does not let an async callback escape the SQLite transaction", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });

    expect(() => store.transact(async () => "not committed"))
      .toThrowError(expect.objectContaining({ code: "transaction_async" }));
    expect(() => store.read(async () => "not read"))
      .toThrowError(expect.objectContaining({ code: "transaction_async" }));
    expect(store.verifyIntegrity()).toEqual({ valid: true, projectCount: 0, eventCount: 0 });
    store.close();
  });

  it("refuses to reopen a database that lost an append-only trigger", async () => {
    const path = await databasePath();
    const store = await HubSyncSQLiteStore.open({ path });
    store.close();
    const tampered = new DatabaseSync(path);
    tampered.exec("DROP TRIGGER hub_events_no_update;");
    tampered.close();

    await expect(HubSyncSQLiteStore.open({ path }))
      .rejects.toMatchObject({ code: "integrity_failed" });
  });
});
