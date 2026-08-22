import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";
import { HubTraceReader } from "@lervo/hub-trace";

import { HubSyncSQLiteStore } from "../src/index.js";
import {
  acceptEvents,
  databasePath,
  eventChain,
  manifest,
  registerStore,
  removeTemporaryRoots,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("Hub sync SQLite integrity lifecycle", () => {
  it("keeps startup checks bounded and reserves full validation for explicit audit", async () => {
    const path = await databasePath();
    const project = manifest("prj_hub_audit_01");
    const store = await HubSyncSQLiteStore.open({ path });
    await registerStore(store, project);
    await acceptEvents(store, project, eventChain(project.projectId, 1));
    await store.close();

    const tampered = new DatabaseSync(path);
    tampered.exec("DROP TRIGGER hub_events_no_update;");
    const row = tampered.prepare("SELECT event_json FROM hub_events LIMIT 1").get();
    const event = JSON.parse(String(row?.event_json)) as Record<string, unknown>;
    event.eventId = "evt_tampered_audit_01";
    tampered.prepare("UPDATE hub_events SET event_json = ?").run(JSON.stringify(event));
    tampered.exec(`
      CREATE TRIGGER hub_events_no_update BEFORE UPDATE ON hub_events
      BEGIN SELECT RAISE(ABORT, 'hub events are append-only'); END;
    `);
    tampered.close();

    const reopened = await HubSyncSQLiteStore.open({ path });
    await expect(reopened.checkIntegrity()).resolves.toMatchObject({ eventCount: 1 });
    await expect(reopened.auditIntegrity()).rejects.toMatchObject({ code: "integrity_failed" });
    await reopened.close();
  });

  it("audits derived run indexes against event originals", async () => {
    const path = await databasePath();
    const project = manifest("prj_hub_index_audit_01");
    const store = await HubSyncSQLiteStore.open({ path });
    await registerStore(store, project);
    await acceptEvents(store, project, eventChain(project.projectId, 2));
    await store.close();

    const tampered = new DatabaseSync(path);
    tampered.prepare("UPDATE hub_runs SET event_count = event_count + 1").run();
    tampered.close();
    const reopened = await HubSyncSQLiteStore.open({ path });
    await expect(reopened.auditIntegrity()).rejects.toMatchObject({ code: "integrity_failed" });
    await reopened.close();
  });

  it("audits and refuses to read graph evidence that differs from the source event", async () => {
    const path = await databasePath();
    const project = manifest("prj_hub_graph_audit_01");
    const store = await HubSyncSQLiteStore.open({ path });
    await registerStore(store, project);
    await acceptEvents(store, project, eventChain(project.projectId, 1));
    await store.close();

    const tampered = new DatabaseSync(path);
    tampered.prepare(`
      UPDATE hub_knowledge_graph_relations
      SET evidence_event_id = 'evt_graph_evidence_tampered'
    `).run();
    tampered.close();

    const reopened = await HubSyncSQLiteStore.open({ path });
    await expect(new HubTraceReader(reopened).getKnowledgeGraph({
      destinationId: "hub:primary",
      projectId: project.projectId,
      focus: { kind: "project", id: project.projectId },
    })).rejects.toMatchObject({ code: "integrity_failed" });
    await expect(reopened.auditIntegrity()).rejects.toMatchObject({ code: "integrity_failed" });
    await reopened.close();
  });

  it("backfills bounded trace indexes when opening the previous schema", async () => {
    const path = await databasePath();
    const project = manifest("prj_hub_migrate_01");
    const store = await HubSyncSQLiteStore.open({ path });
    await registerStore(store, project);
    await acceptEvents(store, project, eventChain(project.projectId, 2));
    await store.close();

    const previous = new DatabaseSync(path);
    previous.exec(`
      DROP INDEX hub_knowledge_graph_to;
      DROP INDEX hub_knowledge_graph_from;
      DROP TABLE hub_knowledge_graph_relations;
      DELETE FROM hub_sync_meta WHERE key = 'knowledge_graph_index_version';
      DROP TRIGGER hub_policy_revocations_no_delete;
      DROP TRIGGER hub_policy_revocations_no_update;
      DROP TRIGGER hub_policy_approvals_no_delete;
      DROP TRIGGER hub_policy_approvals_no_update;
      DROP TRIGGER hub_policy_snapshots_no_delete;
      DROP TRIGGER hub_policy_snapshots_no_update;
      DROP TABLE hub_policy_revocations;
      DROP TABLE hub_policy_approvals;
      DROP TABLE hub_policy_snapshots;
      DROP TRIGGER hub_remote_command_authorships_no_delete;
      DROP TRIGGER hub_remote_command_authorships_no_update;
      DROP TABLE hub_remote_command_authorships;
      DROP TRIGGER hub_remote_commands_identity_immutable;
      DROP TRIGGER hub_remote_commands_no_delete;
      DROP TABLE hub_remote_commands;
      DROP TABLE hub_run_sessions;
      DROP TABLE hub_runs;
      ALTER TABLE hub_projects DROP COLUMN run_count;
      ALTER TABLE hub_projects DROP COLUMN stored_event_count;
      DELETE FROM hub_sync_meta WHERE key IN ('project_count', 'event_count');
      PRAGMA user_version = 2;
      UPDATE hub_sync_meta SET value = '2' WHERE key = 'storage_schema_version';
    `);
    previous.close();

    const migrated = await HubSyncSQLiteStore.open({ path });
    await expect(new HubTraceReader(migrated).listProjects()).resolves.toMatchObject({
      items: [{ projectId: project.projectId, storedEventCount: 2, runCount: 1 }],
    });
    await expect(migrated.auditIntegrity()).resolves.toEqual({
      valid: true,
      projectCount: 1,
      eventCount: 2,
    });
    await migrated.close();
  });

  it("refuses to reopen a database that lost an append-only trigger", async () => {
    const path = await databasePath();
    const store = await HubSyncSQLiteStore.open({ path });
    await store.close();
    const tampered = new DatabaseSync(path);
    tampered.exec("DROP TRIGGER hub_events_no_update;");
    tampered.close();
    await expect(HubSyncSQLiteStore.open({ path })).rejects.toMatchObject({
      code: "integrity_failed",
    });
  });
});
