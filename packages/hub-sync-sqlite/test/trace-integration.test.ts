import { HubProjectScopedTraceReader, HubTraceReader } from "@lervo/hub-trace";
import { afterEach, describe, expect, it } from "vitest";

import { HubSyncSQLiteStore } from "../src/index.js";
import {
  acceptEvents,
  databasePath,
  destinationId,
  eventChain,
  manifest,
  registerStore,
  removeTemporaryRoots,
} from "./fixture.js";

afterEach(removeTemporaryRoots);

describe("Hub trace SQLite query source", () => {
  it("applies the authorized project scope inside the SQLite query", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const allowed = manifest("prj_hub_scope_01");
    const forbidden = manifest("prj_hub_scope_02");
    await registerStore(store, allowed);
    await registerStore(store, forbidden);
    const reader = new HubProjectScopedTraceReader(store, [{
      destinationId,
      projectId: allowed.projectId,
    }]);

    await expect(reader.listProjects()).resolves.toMatchObject({
      items: [{ projectId: allowed.projectId }],
      nextCursor: null,
    });
    await expect(reader.getProject({
      destinationId,
      projectId: forbidden.projectId,
    })).rejects.toMatchObject({ code: "project_forbidden" });
    await store.close();
  });

  it("separates projects with stable cursor pages", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const projects = [manifest("prj_hub_sync_01"), manifest("prj_hub_sync_02")];
    for (const project of projects) {
      await registerStore(store, project);
      await acceptEvents(store, project, eventChain(project.projectId, 1));
    }
    const reader = new HubTraceReader(store);
    const first = await reader.listProjects({ limit: 1 });
    expect(first.items.map((item) => item.projectId)).toEqual([projects[0]!.projectId]);
    expect(first.nextCursor).toEqual({ destinationId, projectId: projects[0]!.projectId });
    const second = await reader.listProjects({ limit: 1, after: first.nextCursor! });
    expect(second.items.map((item) => item.projectId)).toEqual([projects[1]!.projectId]);
    expect(second.nextCursor).toBeNull();
    await store.close();
  });

  it("pages a run timeline without returning its full event history", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest("prj_hub_page_01");
    await registerStore(store, project);
    await acceptEvents(store, project, eventChain(project.projectId, 50));
    const reader = new HubTraceReader(store);
    const first = await reader.getRun({
      destinationId,
      projectId: project.projectId,
      runId: `run_hub_${project.projectId.slice(4)}`,
      limit: 10,
    });
    expect(first.events.items).toHaveLength(10);
    expect(first.events.nextCursor).toEqual({ seq: 10 });
    const second = await reader.getRun({
      destinationId,
      projectId: project.projectId,
      runId: first.run.runId,
      after: first.events.nextCursor!,
      limit: 10,
    });
    expect(second.events.items.map((item) => item.event.seq)).toEqual([
      11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    await store.close();
  });

  it("pages run summaries and preserves allowlisted evidence payloads", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest("prj_hub_runs_01");
    const hash = "sha256:" + "b".repeat(64);
    const events = eventChain(project.projectId, 4, (seq) => {
      if (seq === 1) return {
        runId: "run_hub_evidence_01",
        sessionId: "ses_hub_evidence_01",
        type: "context.selected",
        payload: {
          documentId: "doc_agents_01",
          reasonCode: "path_rule",
          ruleId: "rule_agents_01",
          required: true,
          scope: "project",
        },
      };
      if (seq === 2) return {
        runId: "run_hub_evidence_01",
        sessionId: "ses_hub_evidence_02",
        type: "verification.completed",
        payload: {
          verificationId: "ver_aaaaaaaaaaaaaaaa",
          suiteId: "project.check",
          suiteHash: hash,
          repositoryRevision: hash,
          status: "passed",
          resultArtifactId: "art_" + "b".repeat(64),
          resultContentHash: hash,
          nonPassedCommandIds: [],
        },
      };
      return { runId: `run_hub_page_0${seq - 1}` };
    });
    await registerStore(store, project);
    await acceptEvents(store, project, events);
    const reader = new HubTraceReader(store);
    const projectTrace = await reader.getProject({
      destinationId,
      projectId: project.projectId,
      limit: 2,
    });
    expect(projectTrace.runs.items).toEqual([
      expect.objectContaining({ runId: "run_hub_evidence_01", sessionCount: 2 }),
      expect.objectContaining({ runId: "run_hub_page_02" }),
    ]);
    expect(projectTrace.runs.nextCursor).toEqual({ firstSeq: 3, runId: "run_hub_page_02" });
    const evidence = await reader.getRun({
      destinationId,
      projectId: project.projectId,
      runId: "run_hub_evidence_01",
    });
    expect(evidence.events.items.map((item) => item.event.type)).toEqual([
      "context.selected",
      "verification.completed",
    ]);
    expect(evidence.events.items[0]!.event.payload).toMatchObject({
      documentId: "doc_agents_01",
      reasonCode: "path_rule",
    });
    await store.close();
  });

  it("bounds session identifiers in a run summary", async () => {
    const store = await HubSyncSQLiteStore.open({ path: await databasePath() });
    const project = manifest("prj_hub_sessions_01");
    await registerStore(store, project);
    await acceptEvents(store, project, eventChain(project.projectId, 20, (seq) => ({
      runId: "run_hub_sessions_01",
      sessionId: `ses_hub_sessions_${String(seq).padStart(2, "0")}`,
    })));
    const trace = await new HubTraceReader(store).getProject({
      destinationId,
      projectId: project.projectId,
    });
    expect(trace.runs.items[0]).toMatchObject({
      sessionCount: 20,
      sessionIdsTruncated: true,
    });
    expect(trace.runs.items[0]!.sessionIds).toHaveLength(16);
    await store.close();
  });
});
